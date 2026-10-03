import { cors } from 'hono/cors';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../env';

/** Paths that a browser calls with the session cookie. */
export const COOKIE_PATHS = ['/auth', '/console'] as const;
const isCookiePath = (path: string) =>
  COOKIE_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));

const webOrigin = (value: string | undefined): string | undefined => {
  try {
    return value ? new URL(value).origin : undefined;
  } catch {
    return undefined;
  }
};

/**
 * This API answers JSON only, so the policy is the strictest one: nothing may load, nothing
 * may frame it. (The web app has its own CSP in apps/web/public/_headers.)
 */
export const securityHeaders = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  const h = c.res.headers;
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('X-Frame-Options', 'DENY');
  h.set('Referrer-Policy', 'no-referrer');
  h.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  h.set('Cross-Origin-Resource-Policy', 'same-site');
  if (c.env?.ENVIRONMENT !== 'development') {
    h.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  }
  if (isCookiePath(c.req.path) && !h.has('Cache-Control')) h.set('Cache-Control', 'no-store');
});

/** Only the Fluvia web origin may call the cookie routes from a browser, with credentials. */
export const corsForWeb = createMiddleware<AppEnv>(async (c, next) => {
  if (!isCookiePath(c.req.path)) return next();
  const allowed = webOrigin(c.env.WEB_BASE_URL);
  return cors({
    origin: (origin) => (allowed && origin === allowed ? origin : ''),
    credentials: true,
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['content-type', 'x-fluvia-csrf'],
    maxAge: 600,
  })(c, next);
});

/**
 * CSRF for cookie routes. SameSite=Lax already blocks cross-site POSTs; this adds two more
 * independent checks on every state-changing request: the Origin must be the web app, and a
 * custom header must be present (a cross-site page cannot send it without a CORS preflight,
 * which corsForWeb refuses).
 */
export const csrfGuard = createMiddleware<AppEnv>(async (c, next) => {
  const safe = ['GET', 'HEAD', 'OPTIONS'].includes(c.req.method);
  if (safe || !isCookiePath(c.req.path)) return next();
  const allowed = webOrigin(c.env.WEB_BASE_URL);
  if (!allowed || c.req.header('origin') !== allowed || c.req.header('x-fluvia-csrf') !== '1') {
    throw new HTTPException(403, { message: 'Forbidden' });
  }
  return next();
});

/** Rejects oversized bodies before parsing them (JSON endpoints here need a few hundred bytes). */
export const bodyLimit = (maxBytes: number) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const declared = Number(c.req.header('content-length') ?? 0);
    if (declared > maxBytes) throw new HTTPException(413, { message: 'Payload too large' });
    return next();
  });
