import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { HTTPException } from 'hono/http-exception';
import { fromBase64, toBase64Url, utf8 } from '../encoding';
import { AUTH_LIMITS } from './config';
import { randomRecoveryCode } from './secrets';
import {
  completeLogin,
  enforce,
  failMfa,
  human,
  openSession,
  recoveryHash,
  type AuthContext,
  type AuthDeps,
  type IssuedSession,
} from './service';

const MINUTE = 60_000;
const RECOVERY_CODES = 10;

const invalid = () => new HTTPException(401, { message: 'Invalid passkey' });

export type PasskeyView = {
  id: string;
  deviceName: string;
  deviceType: string;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
};

const view = (p: {
  id: string;
  deviceName: string;
  deviceType: string;
  backedUp: boolean;
  createdAt: Date;
  lastUsedAt: Date | null;
}): PasskeyView => ({
  id: p.id,
  deviceName: p.deviceName,
  deviceType: p.deviceType,
  backedUp: p.backedUp,
  createdAt: p.createdAt.toISOString(),
  lastUsedAt: p.lastUsedAt?.toISOString() ?? null,
});

/**
 * Who may add a passkey. A full session always may. A session that only passed the email
 * step may ONLY when the person has no second factor yet (first enrollment): otherwise
 * whoever read the mailbox could add their own key and skip the TOTP/passkey that protects it.
 */
function assertMayRegister(ctx: AuthContext): void {
  if (ctx.session.stage === 'full') return;
  if (ctx.staff.totpEnrolledAt || ctx.staff.passkeyCount > 0) {
    throw new HTTPException(409, { message: 'Already enrolled' });
  }
}

export async function startPasskeyRegistration(deps: AuthDeps, ctx: AuthContext) {
  assertMayRegister(ctx);
  const { rpId, rpName } = deps.config.webauthn;
  const existing = await deps.store.listPasskeys(ctx.staff.id);
  const options = await generateRegistrationOptions({
    rpName,
    rpID: rpId,
    userName: ctx.staff.email,
    userDisplayName: ctx.staff.name,
    userID: new Uint8Array(utf8(ctx.staff.id)),
    attestationType: 'none',
    timeout: 120_000,
    excludeCredentials: existing.map((p) => ({ id: p.credentialId, transports: p.transports })),
    // Discoverable + verified user: the passkey alone is a complete, multi-factor login.
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  const challengeId = await deps.store.createChallenge({
    purpose: 'register',
    challenge: options.challenge,
    staffUserId: ctx.staff.id,
    expiresAt: new Date(deps.now().getTime() + AUTH_LIMITS.challengeMinutes * MINUTE),
  });
  return { challengeId, options };
}

export async function finishPasskeyRegistration(
  deps: AuthDeps,
  ctx: AuthContext,
  input: { challengeId: string; response: RegistrationResponseJSON; deviceName: string },
): Promise<{
  session: IssuedSession | null;
  recoveryCodes: string[] | null;
  passkey: PasskeyView;
}> {
  assertMayRegister(ctx);
  const fail = (action: string) =>
    ctx.session.stage === 'full'
      ? deps
          .audit({ ...human(ctx.staff), action, entityType: 'staff_user', entityId: ctx.staff.id })
          .then(() => {
            throw new HTTPException(400, { message: 'Invalid passkey' });
          })
      : failMfa(deps, ctx, action);

  // The challenge is spent first: one try per challenge, even if the answer is wrong.
  const challenge = await deps.store.consumeChallenge({
    id: input.challengeId,
    purpose: 'register',
    now: deps.now(),
  });
  if (!challenge || challenge.staffUserId !== ctx.staff.id)
    return fail('auth.passkey_register_failed');

  let verified;
  try {
    verified = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: deps.config.webauthn.origin,
      expectedRPID: deps.config.webauthn.rpId,
      requireUserVerification: true,
    });
  } catch {
    return fail('auth.passkey_register_failed');
  }
  if (!verified.verified) return fail('auth.passkey_register_failed');

  const { credential, credentialDeviceType, credentialBackedUp } = verified.registrationInfo;
  const added = await deps.store.addPasskey({
    staffUserId: ctx.staff.id,
    credentialId: credential.id,
    publicKey: toBase64Url(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports ?? [],
    deviceName: input.deviceName,
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
  });
  if (!added) throw new HTTPException(409, { message: 'That passkey is already registered' });

  // Recovery codes exist for every kind of second factor; create them on the first one.
  let recoveryCodes: string[] | null = null;
  const fresh = Array.from({ length: RECOVERY_CODES }, randomRecoveryCode);
  const hashes = await Promise.all(fresh.map((c) => recoveryHash(deps, c)));
  if (await deps.store.setRecoveryCodesIfEmpty(ctx.staff.id, hashes)) recoveryCodes = fresh;

  await deps.audit({
    ...human(ctx.staff),
    action: 'auth.passkey_registered',
    entityType: 'staff_user',
    entityId: ctx.staff.id,
    after: { deviceType: credentialDeviceType },
  });
  const session =
    ctx.session.stage === 'email_verified'
      ? await completeLogin(deps, ctx, 'passkey_enroll')
      : null;
  const stored = (await deps.store.listPasskeys(ctx.staff.id)).find(
    (p) => p.credentialId === credential.id,
  );
  return {
    session,
    recoveryCodes,
    passkey: view(
      stored ?? {
        id: '',
        deviceName: input.deviceName,
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        createdAt: deps.now(),
        lastUsedAt: null,
      },
    ),
  };
}

/** Anonymous: no email typed, the browser offers the passkeys it holds for this site. */
export async function startPasskeyLogin(deps: AuthDeps, input: { ip: string }) {
  await enforce(deps, `passkey:ip:${input.ip}`, AUTH_LIMITS.ipVerifyPerMinute, 60);
  const options = await generateAuthenticationOptions({
    rpID: deps.config.webauthn.rpId,
    userVerification: 'required',
    timeout: 120_000,
  });
  const challengeId = await deps.store.createChallenge({
    purpose: 'login',
    challenge: options.challenge,
    staffUserId: null,
    expiresAt: new Date(deps.now().getTime() + AUTH_LIMITS.challengeMinutes * MINUTE),
  });
  return { challengeId, options };
}

export async function finishPasskeyLogin(
  deps: AuthDeps,
  input: { challengeId: string; response: AuthenticationResponseJSON; ip: string },
): Promise<IssuedSession> {
  await enforce(deps, `passkey-verify:ip:${input.ip}`, AUTH_LIMITS.ipVerifyPerMinute, 60);
  const reject = async (reason: string, staffId?: string): Promise<never> => {
    await deps.audit({
      actorType: 'system',
      actorId: 'auth',
      action: 'auth.passkey_login_failed',
      ...(staffId ? { entityType: 'staff_user', entityId: staffId } : {}),
      after: { reason },
    });
    throw invalid();
  };

  const challenge = await deps.store.consumeChallenge({
    id: input.challengeId,
    purpose: 'login',
    now: deps.now(),
  });
  if (!challenge) return reject('challenge');

  const passkey = await deps.store.findPasskeyByCredentialId(input.response.id);
  const staff = passkey ? await deps.store.findStaffById(passkey.staffUserId) : null;
  if (!passkey || !staff) return reject('unknown_credential');
  if (staff.disabledAt) return reject('disabled', staff.id);

  // A discoverable credential also names its owner; if it does, it must be this person.
  const handle = input.response.response.userHandle;
  if (handle) {
    const bytes = fromBase64(handle);
    if (!bytes || new TextDecoder().decode(bytes) !== staff.id)
      return reject('user_handle', staff.id);
  }

  let verified;
  try {
    verified = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: deps.config.webauthn.origin,
      expectedRPID: deps.config.webauthn.rpId,
      requireUserVerification: true,
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array(fromBase64(passkey.publicKey) ?? []),
        counter: passkey.counter,
        transports: passkey.transports,
      },
    });
  } catch {
    return reject('verification', staff.id);
  }
  if (!verified.verified) return reject('verification', staff.id);

  // A counter that does not go up means the key may have been cloned: refuse and leave a trace.
  const accepted = await deps.store.recordPasskeyUse({
    id: passkey.id,
    counter: verified.authenticationInfo.newCounter,
    now: deps.now(),
  });
  if (!accepted) return reject('counter', staff.id);

  const session = await openSession(deps, staff, 'full');
  await deps.audit({
    ...human(staff),
    action: 'auth.login',
    entityType: 'staff_user',
    entityId: staff.id,
    after: { method: 'passkey' },
  });
  return session;
}

export async function listPasskeys(deps: AuthDeps, ctx: AuthContext): Promise<PasskeyView[]> {
  return (await deps.store.listPasskeys(ctx.staff.id)).map(view);
}

/** A person may remove their own passkeys, but never their last second factor. */
export async function removePasskey(deps: AuthDeps, ctx: AuthContext, id: string): Promise<void> {
  const mine = await deps.store.listPasskeys(ctx.staff.id);
  if (!mine.some((p) => p.id === id))
    throw new HTTPException(404, { message: 'Passkey not found' });
  if (mine.length === 1 && !ctx.staff.totpEnrolledAt) {
    throw new HTTPException(409, { message: 'You cannot remove your last sign-in method' });
  }
  await deps.store.deletePasskey(ctx.staff.id, id);
  await deps.audit({
    ...human(ctx.staff),
    action: 'auth.passkey_removed',
    entityType: 'staff_user',
    entityId: ctx.staff.id,
  });
}
