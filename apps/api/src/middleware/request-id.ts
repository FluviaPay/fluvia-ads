import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../env';

const VALID_ID = /^[\w.-]{1,128}$/;

export const requestId = createMiddleware<AppEnv>(async (c, next) => {
  const incoming = c.req.header('x-request-id');
  const id = incoming && VALID_ID.test(incoming) ? incoming : crypto.randomUUID();
  c.set('requestId', id);
  c.header('x-request-id', id);
  await next();
});
