import { HTTPException } from 'hono/http-exception';
import { decryptToken, encryptToken } from '../crypto';
import { safeEqual } from '../encoding';
import type { AuditEntry } from '../audit';
import { AUTH_LIMITS, type AuthConfig } from './config';
import type { Mailer } from './mailer';
import type { RateLimiterFn } from './rate-limit';
import {
  hmacHex,
  normalizeRecoveryCode,
  randomCode,
  randomRecoveryCode,
  randomToken,
  sha256Hex,
} from './secrets';
import type { AuthStore, SessionRecord, StaffRecord } from './store';
import { generateTotpSecret, otpauthUri, verifyTotp } from './totp';

export type AuthDeps = {
  store: AuthStore;
  mailer: Mailer;
  limiter: RateLimiterFn;
  config: AuthConfig;
  now: () => Date;
  audit: (entry: AuditEntry) => Promise<void>;
};

export type AuthContext = { session: SessionRecord; staff: StaffRecord };
export type IssuedSession = { token: string; expiresAt: Date };

const RECOVERY_CODES = 10;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const unauthorized = (message = 'Unauthorized') => new HTTPException(401, { message });
const tooMany = (retryAfterSeconds: number) =>
  new HTTPException(429, {
    message: 'Too many attempts, try again later',
    res: new Response(null, { headers: { 'retry-after': String(retryAfterSeconds) } }),
  });

export const normalizeEmail = (value: string) => value.trim().toLowerCase();

export const human = (staff: Pick<StaffRecord, 'id'>) =>
  ({ actorType: 'human', actorId: `staff:${staff.id}` }) as const;

const totpAad = (staffId: string) => `staff_users:${staffId}`;

export async function enforce(
  deps: AuthDeps,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const result = await deps.limiter(key, limit, windowSeconds);
  if (!result.allowed) throw tooMany(result.retryAfterSeconds);
}

/** Step 1. Always looks the same from outside, whether or not the email is registered. */
export async function requestLoginCode(
  deps: AuthDeps,
  input: { email: string; ip: string },
): Promise<{ deliver: Promise<void> }> {
  await enforce(deps, `login:ip:${input.ip}`, AUTH_LIMITS.ipLoginPerMinute, 60);

  const email = normalizeEmail(input.email);
  const staff = await deps.store.findStaffByEmail(email);
  const code = randomCode();
  // Same work either way (hash + one limiter hit) so the response time says little.
  const codeHash = await hmacHex(deps.config.authSecret, `code:${staff?.id ?? 'none'}:${code}`);
  const perEmail = await deps.limiter(
    `login:email:${await sha256Hex(email)}`,
    AUTH_LIMITS.maxCodesPerHour,
    3600,
  );

  if (!staff || staff.disabledAt || !perEmail.allowed) {
    await deps.audit({
      actorType: 'system',
      actorId: 'auth',
      action: 'auth.login_code_not_sent',
      after: { reason: !staff ? 'unknown' : staff.disabledAt ? 'disabled' : 'rate_limited' },
    });
    return { deliver: Promise.resolve() };
  }

  const now = deps.now();
  await deps.store.createLoginCode({
    staffUserId: staff.id,
    codeHash,
    expiresAt: new Date(now.getTime() + AUTH_LIMITS.codeTtlMinutes * MINUTE),
    now,
  });
  await deps.audit({
    ...human(staff),
    action: 'auth.login_code_sent',
    entityType: 'staff_user',
    entityId: staff.id,
  });
  return {
    deliver: deps.mailer.sendLoginCode({
      to: staff.email,
      code,
      minutes: AUTH_LIMITS.codeTtlMinutes,
    }),
  };
}

export async function openSession(
  deps: AuthDeps,
  staff: StaffRecord,
  stage: 'email_verified' | 'full',
): Promise<IssuedSession> {
  const now = deps.now();
  const token = randomToken();
  const ttl =
    stage === 'full'
      ? AUTH_LIMITS.absoluteTimeoutHours * HOUR
      : AUTH_LIMITS.pendingMfaMinutes * MINUTE;
  const expiresAt = new Date(now.getTime() + ttl);
  await deps.store.createSession({
    staffUserId: staff.id,
    tokenHash: await sha256Hex(token),
    stage,
    expiresAt,
    now,
  });
  return { token, expiresAt };
}

/** Step 2. A good code opens a half session: the second factor is still missing. */
export async function verifyEmailCode(
  deps: AuthDeps,
  input: { email: string; code: string; ip: string },
): Promise<{
  session: IssuedSession;
  next: 'second_factor' | 'enroll';
  methods: { totp: boolean; passkey: boolean };
}> {
  await enforce(deps, `verify:ip:${input.ip}`, AUTH_LIMITS.ipVerifyPerMinute, 60);

  const staff = await deps.store.findStaffByEmail(normalizeEmail(input.email));
  const usable = staff && !staff.disabledAt ? staff : null;
  const attempt = usable
    ? await deps.store.takeCodeAttempt({
        staffUserId: usable.id,
        now: deps.now(),
        maxAttempts: AUTH_LIMITS.maxCodeAttempts,
      })
    : null;
  const expected = attempt?.codeHash ?? '';
  const given = await hmacHex(deps.config.authSecret, `code:${usable?.id ?? 'none'}:${input.code}`);
  const matches = await safeEqual(given, expected);

  if (
    !usable ||
    !attempt ||
    !matches ||
    !(await deps.store.consumeLoginCode(attempt.id, deps.now()))
  ) {
    await deps.audit({
      actorType: 'system',
      actorId: 'auth',
      action: 'auth.login_code_failed',
      ...(usable ? { entityType: 'staff_user', entityId: usable.id } : {}),
    });
    throw unauthorized('Invalid or expired code');
  }

  const session = await openSession(deps, usable, 'email_verified');
  await deps.audit({
    ...human(usable),
    action: 'auth.email_verified',
    entityType: 'staff_user',
    entityId: usable.id,
  });
  const methods = { totp: usable.totpEnrolledAt !== null, passkey: usable.passkeyCount > 0 };
  return { session, next: methods.totp || methods.passkey ? 'second_factor' : 'enroll', methods };
}

/** Looks the cookie up. `requireFull` is false only for the second-factor endpoints. */
export async function authenticate(
  deps: AuthDeps,
  token: string | undefined,
  stage: 'full' | 'email_verified',
): Promise<AuthContext | null> {
  if (!token || token.length > 128) return null;
  const found = await deps.store.findSession(await sha256Hex(token));
  if (!found) return null;
  const { session, staff } = found;
  const now = deps.now();

  const idleMs = AUTH_LIMITS.idleTimeoutMinutes * MINUTE;
  const dead =
    session.revokedAt !== null ||
    session.expiresAt <= now ||
    staff.disabledAt !== null ||
    session.stage !== stage ||
    (session.stage === 'full' && now.getTime() - session.lastSeenAt.getTime() > idleMs);
  if (dead) return null;

  if (now.getTime() - session.lastSeenAt.getTime() > MINUTE) {
    await deps.store.touchSession(session.id, now);
  }
  return found;
}

export async function failMfa(deps: AuthDeps, ctx: AuthContext, action: string): Promise<never> {
  const attempts = await deps.store.bumpMfaAttempts(ctx.session.id);
  if (attempts >= AUTH_LIMITS.maxMfaAttempts) {
    await deps.store.revokeSession(ctx.session.id, deps.now());
  }
  await deps.audit({
    ...human(ctx.staff),
    action,
    entityType: 'staff_user',
    entityId: ctx.staff.id,
    after: { attempts },
  });
  throw unauthorized('Invalid code');
}

export async function completeLogin(
  deps: AuthDeps,
  ctx: AuthContext,
  method: string,
): Promise<IssuedSession> {
  await deps.store.revokeSession(ctx.session.id, deps.now());
  const issued = await openSession(deps, ctx.staff, 'full');
  await deps.audit({
    ...human(ctx.staff),
    action: 'auth.login',
    entityType: 'staff_user',
    entityId: ctx.staff.id,
    after: { method },
  });
  return issued;
}

/** Enrollment, part 1: a fresh secret; it only counts once a code from it is confirmed. */
export async function startTotpEnrollment(
  deps: AuthDeps,
  ctx: AuthContext,
): Promise<{ secret: string; otpauthUri: string }> {
  if (ctx.staff.totpEnrolledAt || ctx.staff.passkeyCount > 0) {
    throw new HTTPException(409, { message: 'Already enrolled' });
  }
  const secret = generateTotpSecret();
  await deps.store.saveProposedTotp(
    ctx.staff.id,
    await encryptToken(deps.config.tokenKey, secret, totpAad(ctx.staff.id)),
  );
  return {
    secret,
    otpauthUri: otpauthUri({ secret, email: ctx.staff.email, issuer: deps.config.issuer }),
  };
}

/** Enrollment, part 2: returns the recovery codes ONCE; only their hashes are kept. */
export async function confirmTotpEnrollment(
  deps: AuthDeps,
  ctx: AuthContext,
  code: string,
): Promise<{ session: IssuedSession; recoveryCodes: string[] }> {
  if (ctx.staff.totpEnrolledAt || ctx.staff.passkeyCount > 0) {
    throw new HTTPException(409, { message: 'Already enrolled' });
  }
  if (!ctx.staff.totpSecretEnc) throw new HTTPException(409, { message: 'Start enrollment first' });

  const secret = await decryptToken(
    deps.config.tokenKey,
    ctx.staff.totpSecretEnc,
    totpAad(ctx.staff.id),
  );
  const step = await verifyTotp(secret, code, deps.now(), null);
  if (step === null) return failMfa(deps, ctx, 'auth.totp_enroll_failed');

  const recoveryCodes = Array.from({ length: RECOVERY_CODES }, randomRecoveryCode);
  const hashes = await Promise.all(recoveryCodes.map((c) => recoveryHash(deps, c)));
  if (
    !(await deps.store.confirmTotp({
      staffUserId: ctx.staff.id,
      step,
      recoveryCodeHashes: hashes,
      now: deps.now(),
    }))
  ) {
    throw new HTTPException(409, { message: 'Already enrolled' });
  }
  await deps.audit({
    ...human(ctx.staff),
    action: 'auth.totp_enrolled',
    entityType: 'staff_user',
    entityId: ctx.staff.id,
  });
  return { session: await completeLogin(deps, ctx, 'totp_enroll'), recoveryCodes };
}

export async function verifyTotpLogin(
  deps: AuthDeps,
  ctx: AuthContext,
  code: string,
): Promise<IssuedSession> {
  if (!ctx.staff.totpEnrolledAt || !ctx.staff.totpSecretEnc) {
    throw new HTTPException(409, { message: 'Enroll first' });
  }
  const secret = await decryptToken(
    deps.config.tokenKey,
    ctx.staff.totpSecretEnc,
    totpAad(ctx.staff.id),
  );
  const step = await verifyTotp(secret, code, deps.now(), ctx.staff.totpLastStep);
  // The atomic update is what blocks two parallel uses of the same code.
  if (step === null || !(await deps.store.advanceTotpStep(ctx.staff.id, step))) {
    return failMfa(deps, ctx, 'auth.totp_failed');
  }
  return completeLogin(deps, ctx, 'totp');
}

export async function useRecoveryCode(
  deps: AuthDeps,
  ctx: AuthContext,
  code: string,
): Promise<IssuedSession> {
  if (!ctx.staff.totpEnrolledAt && ctx.staff.passkeyCount === 0) {
    throw new HTTPException(409, { message: 'Enroll first' });
  }
  const hash = await recoveryHash(deps, code);
  if (!(await deps.store.consumeRecoveryCode(ctx.staff.id, hash))) {
    return failMfa(deps, ctx, 'auth.recovery_failed');
  }
  await deps.audit({
    ...human(ctx.staff),
    action: 'auth.recovery_code_used',
    entityType: 'staff_user',
    entityId: ctx.staff.id,
  });
  return completeLogin(deps, ctx, 'recovery_code');
}

export const recoveryHash = (deps: AuthDeps, code: string) =>
  hmacHex(deps.config.authSecret, `recovery:${normalizeRecoveryCode(code)}`);

export async function logout(deps: AuthDeps, ctx: AuthContext): Promise<void> {
  await deps.store.revokeSession(ctx.session.id, deps.now());
  await deps.audit({
    ...human(ctx.staff),
    action: 'auth.logout',
    entityType: 'staff_user',
    entityId: ctx.staff.id,
  });
}
