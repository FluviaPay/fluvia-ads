import { createDb, type Db } from '@fluvia/db';
import { Hono } from 'hono';
import type { AppEnv, Bindings } from './env';
import { createConnectionStore, type ConnectionStore } from './meta/store';
import { onError, notFound } from './middleware/errors';
import { requestLogger } from './middleware/logger';
import { requestId } from './middleware/request-id';
import { health } from './routes/health';
import { createMetaRoutes, defaultMetaFactory, type MetaFactory } from './routes/meta';

export type AppDeps = {
  getDb?: (env: Bindings) => Db;
  getStore?: (env: Bindings) => ConnectionStore;
  meta?: MetaFactory;
  now?: () => Date;
};

export function createApp(deps: AppDeps = {}) {
  const makeDb = deps.getDb ?? ((env: Bindings) => createDb(env.DATABASE_URL));
  const app = new Hono<AppEnv>();

  app.use(requestId);
  app.use(requestLogger);
  app.use(async (c, next) => {
    let db: Db | undefined;
    c.set('getDb', () => (db ??= makeDb(c.env)));
    let store: ConnectionStore | undefined;
    c.set(
      'getStore',
      () => (store ??= deps.getStore?.(c.env) ?? createConnectionStore(c.var.getDb())),
    );
    await next();
  });

  app.route('/', health);
  app.route(
    '/',
    createMetaRoutes({
      meta: deps.meta ?? defaultMetaFactory,
      now: deps.now ?? (() => new Date()),
    }),
  );

  app.onError(onError);
  app.notFound(notFound);
  return app;
}

export const app = createApp();
