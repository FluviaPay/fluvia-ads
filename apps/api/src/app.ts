import { createDb, type Db } from '@fluvia/db';
import { Hono } from 'hono';
import type { AppEnv, Bindings } from './env';
import { onError, notFound } from './middleware/errors';
import { requestLogger } from './middleware/logger';
import { requestId } from './middleware/request-id';
import { health } from './routes/health';

export type AppDeps = { getDb?: (env: Bindings) => Db };

export function createApp(deps: AppDeps = {}) {
  const makeDb = deps.getDb ?? ((env: Bindings) => createDb(env.DATABASE_URL));
  const app = new Hono<AppEnv>();

  app.use(requestId);
  app.use(requestLogger);
  app.use(async (c, next) => {
    let db: Db | undefined;
    c.set('getDb', () => (db ??= makeDb(c.env)));
    await next();
  });

  app.route('/', health);

  app.onError(onError);
  app.notFound(notFound);
  return app;
}

export const app = createApp();
