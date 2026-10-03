import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { authenticate, type AuthContext } from '../auth/service';
import { cookieName } from '../auth/cookie';
import type { Role } from '../auth/store';

declare module 'hono' {
  interface ContextVariableMap {
    staff: AuthContext;
  }
}

export async function currentStaff(
  c: Context<AppEnv>,
  stage: 'full' | 'email_verified',
): Promise<AuthContext | null> {
  const deps = c.var.getAuth();
  return authenticate(deps, getCookie(c, cookieName(deps.config.secureCookies)), stage);
}

/**
 * Every console route goes through this: a fully logged-in (both factors), enabled person
 * with the required role. 401 means "log in", 403 means "logged in but not allowed".
 */
export const requireStaff = (...roles: Role[]) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const ctx = await currentStaff(c, 'full');
    if (!ctx) throw new HTTPException(401, { message: 'Unauthorized' });
    if (roles.length > 0 && !roles.includes(ctx.staff.role)) {
      throw new HTTPException(403, { message: 'Forbidden' });
    }
    c.set('staff', ctx);
    await next();
  });
