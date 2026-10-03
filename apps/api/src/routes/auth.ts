import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { clearSessionCookie, writeSessionCookie } from '../auth/cookie';
import {
  finishPasskeyLogin,
  finishPasskeyRegistration,
  listPasskeys,
  removePasskey,
  startPasskeyLogin,
  startPasskeyRegistration,
} from '../auth/passkeys';
import {
  confirmTotpEnrollment,
  logout,
  requestLoginCode,
  startTotpEnrollment,
  useRecoveryCode,
  verifyEmailCode,
  verifyTotpLogin,
} from '../auth/service';
import type { AppEnv } from '../env';
import { log } from '../logger';
import { bodyLimit } from '../middleware/security';
import { currentStaff } from '../middleware/staff';
import { parseBody } from '../validate';

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
const loginBody = z.strictObject({ email });
const verifyBody = z.strictObject({ email, code: z.string().regex(/^\d{6}$/) });
const totpBody = z.strictObject({ code: z.string().regex(/^\d{6}$/) });
const recoveryBody = z.strictObject({ code: z.string().min(8).max(16) });

const deviceName = z
  .string()
  .trim()
  .min(1)
  .max(60)
  // No control characters or markup-ish brackets: it is shown back in the interface.
  .regex(/^[^\p{C}<>]+$/u);
const credentialJson = z.looseObject({
  id: z.string().min(1).max(1024),
  rawId: z.string().max(1024),
  type: z.literal('public-key'),
  response: z.looseObject({}),
  clientExtensionResults: z.looseObject({}),
});
const challengeId = z.uuid();
const passkeyLoginBody = z.strictObject({ challengeId, response: credentialJson });
const passkeyRegisterBody = z.strictObject({
  challengeId,
  deviceName,
  response: credentialJson,
});

const clientIp = (c: Context<AppEnv>) => c.req.header('cf-connecting-ip') ?? 'unknown';

export function createAuthRoutes() {
  const routes = new Hono<AppEnv>();
  // Passkey answers are a few KB; every other body here is tiny and strictly validated.
  routes.use(bodyLimit(16_384));

  /** Defers slow work past the response when running on Workers; awaits it in tests. */
  const defer = async (c: Context<AppEnv>, work: Promise<void>) => {
    const safe = work.catch((err: Error) =>
      log('error', 'login_email_failed', { request_id: c.get('requestId'), error: err.message }),
    );
    try {
      c.executionCtx.waitUntil(safe);
    } catch {
      await safe;
    }
  };

  // Always 202 and the same body: nobody can learn which emails have an account.
  routes.post('/login', async (c) => {
    const { email: address } = await parseBody(c, loginBody);
    const deps = c.var.getAuth();
    const { deliver } = await requestLoginCode(deps, { email: address, ip: clientIp(c) });
    await defer(c, deliver);
    return c.json({ ok: true }, 202);
  });

  routes.post('/verify', async (c) => {
    const body = await parseBody(c, verifyBody);
    const deps = c.var.getAuth();
    const { session, next, methods } = await verifyEmailCode(deps, { ...body, ip: clientIp(c) });
    writeSessionCookie(c, deps.config.secureCookies, session);
    return c.json({ next, methods });
  });

  routes.post('/totp/enroll', async (c) => {
    const ctx = await currentStaff(c, 'email_verified');
    if (!ctx) throw new HTTPException(401, { message: 'Unauthorized' });
    return c.json(await startTotpEnrollment(c.var.getAuth(), ctx));
  });

  routes.post('/totp/confirm', async (c) => {
    const ctx = await currentStaff(c, 'email_verified');
    if (!ctx) throw new HTTPException(401, { message: 'Unauthorized' });
    const { code } = await parseBody(c, totpBody);
    const deps = c.var.getAuth();
    const { session, recoveryCodes } = await confirmTotpEnrollment(deps, ctx, code);
    writeSessionCookie(c, deps.config.secureCookies, session);
    return c.json({ recoveryCodes });
  });

  routes.post('/totp/verify', async (c) => {
    const ctx = await currentStaff(c, 'email_verified');
    if (!ctx) throw new HTTPException(401, { message: 'Unauthorized' });
    const { code } = await parseBody(c, totpBody);
    const deps = c.var.getAuth();
    writeSessionCookie(c, deps.config.secureCookies, await verifyTotpLogin(deps, ctx, code));
    return c.json({ ok: true });
  });

  routes.post('/recovery', async (c) => {
    const ctx = await currentStaff(c, 'email_verified');
    if (!ctx) throw new HTTPException(401, { message: 'Unauthorized' });
    const { code } = await parseBody(c, recoveryBody);
    const deps = c.var.getAuth();
    writeSessionCookie(c, deps.config.secureCookies, await useRecoveryCode(deps, ctx, code));
    return c.json({ ok: true });
  });

  // ---- Passkeys ---------------------------------------------------------------------
  // Login is anonymous and complete on its own: no email code needed.
  routes.post('/passkey/login/options', async (c) => {
    return c.json(await startPasskeyLogin(c.var.getAuth(), { ip: clientIp(c) }));
  });

  routes.post('/passkey/login/verify', async (c) => {
    const body = await parseBody(c, passkeyLoginBody);
    const deps = c.var.getAuth();
    const session = await finishPasskeyLogin(deps, {
      challengeId: body.challengeId,
      response: body.response as unknown as AuthenticationResponseJSON,
      ip: clientIp(c),
    });
    writeSessionCookie(c, deps.config.secureCookies, session);
    return c.json({ ok: true });
  });

  /** A full session, or the half session of a person with no second factor yet. */
  const anyStage = async (c: Context<AppEnv>) => {
    const ctx = (await currentStaff(c, 'full')) ?? (await currentStaff(c, 'email_verified'));
    if (!ctx) throw new HTTPException(401, { message: 'Unauthorized' });
    return ctx;
  };

  routes.post('/passkey/register/options', async (c) => {
    return c.json(await startPasskeyRegistration(c.var.getAuth(), await anyStage(c)));
  });

  routes.post('/passkey/register/verify', async (c) => {
    const ctx = await anyStage(c);
    const body = await parseBody(c, passkeyRegisterBody);
    const deps = c.var.getAuth();
    const result = await finishPasskeyRegistration(deps, ctx, {
      challengeId: body.challengeId,
      deviceName: body.deviceName,
      response: body.response as unknown as RegistrationResponseJSON,
    });
    if (result.session) writeSessionCookie(c, deps.config.secureCookies, result.session);
    return c.json({ passkey: result.passkey, recoveryCodes: result.recoveryCodes }, 201);
  });

  routes.get('/passkeys', async (c) => {
    const ctx = await currentStaff(c, 'full');
    if (!ctx) throw new HTTPException(401, { message: 'Unauthorized' });
    return c.json({ passkeys: await listPasskeys(c.var.getAuth(), ctx) });
  });

  routes.delete('/passkeys/:id', async (c) => {
    const ctx = await currentStaff(c, 'full');
    if (!ctx) throw new HTTPException(401, { message: 'Unauthorized' });
    const id = z.uuid().safeParse(c.req.param('id'));
    if (!id.success) throw new HTTPException(400, { message: 'Invalid id' });
    await removePasskey(c.var.getAuth(), ctx, id.data);
    return c.json({ ok: true });
  });

  routes.get('/me', async (c) => {
    const ctx = await currentStaff(c, 'full');
    if (!ctx) throw new HTTPException(401, { message: 'Unauthorized' });
    const { id, email: address, name, role, passkeyCount } = ctx.staff;
    return c.json({ id, email: address, name, role, hasPasskey: passkeyCount > 0 });
  });

  routes.post('/logout', async (c) => {
    const deps = c.var.getAuth();
    const ctx = (await currentStaff(c, 'full')) ?? (await currentStaff(c, 'email_verified'));
    if (ctx) await logout(deps, ctx);
    clearSessionCookie(c, deps.config.secureCookies);
    return c.json({ ok: true });
  });

  return routes;
}
