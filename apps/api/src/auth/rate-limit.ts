import type { Bindings } from '../env';
import { NotConfiguredError } from '../meta/config';

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };
export type RateLimiterFn = (
  key: string,
  limit: number,
  windowSeconds: number,
) => Promise<RateLimitResult>;

/** Durable Object backed limiter (shared by every Worker instance). */
export function durableRateLimiter(namespace: DurableObjectNamespace): RateLimiterFn {
  return async (key, limit, windowSeconds) => {
    const stub = namespace.get(namespace.idFromName(key));
    const response = await stub.fetch('https://rate-limiter/hit', {
      method: 'POST',
      body: JSON.stringify({ limit, windowSeconds }),
    });
    if (!response.ok) throw new Error(`Rate limiter answered ${response.status}`);
    return (await response.json()) as RateLimitResult;
  };
}

/** Per-process fallback for local development and tests only. */
export function memoryRateLimiter(now: () => number = Date.now): RateLimiterFn {
  const windows = new Map<string, { count: number; resetAt: number }>();
  return async (key, limit, windowSeconds) => {
    const t = now();
    let w = windows.get(key);
    if (!w || w.resetAt <= t) w = { count: 0, resetAt: t + windowSeconds * 1000 };
    w.count += 1;
    windows.set(key, w);
    const allowed = w.count <= limit;
    return { allowed, retryAfterSeconds: allowed ? 0 : Math.ceil((w.resetAt - t) / 1000) };
  };
}

const developmentLimiter = memoryRateLimiter();

/** Outside development a missing binding is an error: failing open would disable the limits. */
export function rateLimiterFor(env: Bindings): RateLimiterFn {
  if (env.RATE_LIMITER) return durableRateLimiter(env.RATE_LIMITER);
  if (env.ENVIRONMENT === 'development') return developmentLimiter;
  throw new NotConfiguredError(['RATE_LIMITER']);
}
