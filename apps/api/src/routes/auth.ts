import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { clearSessionCookie, writeSessionCookie } from '../auth/cookie';
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

const clientIp = (c: Context<AppEnv>) => c.req.header('cf-connecting-ip') ?? 'unknown';

export function createAuthRoutes() {
  const routes = new Hono<AppEnv>();
  routes.use(bodyLimit(2048));

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
    const { session, next } = await verifyEmailCode(deps, { ...body, ip: clientIp(c) });
    writeSessionCookie(c, deps.config.secureCookies, session);
    return c.json({ next });
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

  routes.get('/me', async (c) => {
    const ctx = await currentStaff(c, 'full');
    if (!ctx) throw new HTTPException(401, { message: 'Unauthorized' });
    const { id, email: address, name, role } = ctx.staff;
    return c.json({ id, email: address, name, role });
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
