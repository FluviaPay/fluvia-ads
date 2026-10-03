import type { Context } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import type { AppEnv } from '../env';
import type { IssuedSession } from './service';

/** `__Host-` makes browsers refuse the cookie unless it is Secure, host-only and Path=/. */
export const cookieName = (secure: boolean) =>
  secure ? '__Host-fluvia_session' : 'fluvia_session';

export function writeSessionCookie(c: Context<AppEnv>, secure: boolean, session: IssuedSession) {
  setCookie(c, cookieName(secure), session.token, {
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    path: '/',
    expires: session.expiresAt,
  });
}

export function clearSessionCookie(c: Context<AppEnv>, secure: boolean) {
  deleteCookie(c, cookieName(secure), { path: '/', secure });
}
