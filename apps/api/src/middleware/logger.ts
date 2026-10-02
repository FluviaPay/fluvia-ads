import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../env';
import { log } from '../logger';

/** One structured line per request. Never logs headers or bodies. */
export const requestLogger = createMiddleware<AppEnv>(async (c, next) => {
  const start = Date.now();
  await next();
  log('info', 'request', {
    request_id: c.get('requestId'),
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    duration_ms: Date.now() - start,
  });
});
