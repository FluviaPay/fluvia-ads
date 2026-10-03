import { createDb, type Db } from '@fluvia/db';
import { Hono } from 'hono';
import { resolveAuthConfig } from './auth/config';
import { consoleMailer, resendMailer, type Mailer } from './auth/mailer';
import { rateLimiterFor, type RateLimiterFn } from './auth/rate-limit';
import type { AuthDeps } from './auth/service';
import { createAuthStore, type AuthStore } from './auth/store';
import { writeAuditLog } from './audit';
import type { AppEnv, Bindings } from './env';
import { queuePublisher, type EventPublisher } from './events';
import { createConnectionStore, type ConnectionStore } from './meta/store';
import { onError, notFound } from './middleware/errors';
import { requestLogger } from './middleware/logger';
import { requestId } from './middleware/request-id';
import { corsForWeb, csrfGuard, securityHeaders } from './middleware/security';
import { createAuthRoutes } from './routes/auth';
import { createConsoleRoutes } from './routes/console';
import type { TaskStore } from './console/tasks-store';
import { health } from './routes/health';
import { createMetaRoutes, defaultMetaFactory, type MetaFactory } from './routes/meta';

export type AppDeps = {
  getDb?: (env: Bindings) => Db;
  getStore?: (env: Bindings) => ConnectionStore;
  meta?: MetaFactory;
  events?: (env: Bindings) => EventPublisher;
  /** Test seams for the staff login; production builds them from the environment. */
  authStore?: (env: Bindings) => AuthStore;
  mailer?: (env: Bindings) => Mailer;
  limiter?: (env: Bindings) => RateLimiterFn;
  tasks?: (env: Bindings) => TaskStore;
  now?: () => Date;
};

export function createApp(deps: AppDeps = {}) {
  const makeDb = deps.getDb ?? ((env: Bindings) => createDb(env.DATABASE_URL));
  const app = new Hono<AppEnv>();

  app.use(requestId);
  app.use(requestLogger);
  app.use(securityHeaders);
  app.use(corsForWeb);
  app.use(csrfGuard);
  app.use(async (c, next) => {
    let db: Db | undefined;
    c.set('getDb', () => (db ??= makeDb(c.env)));
    let store: ConnectionStore | undefined;
    c.set(
      'getStore',
      () => (store ??= deps.getStore?.(c.env) ?? createConnectionStore(c.var.getDb())),
    );
    let auth: AuthDeps | undefined;
    c.set(
      'getAuth',
      () =>
        (auth ??= (() => {
          const config = resolveAuthConfig(c.env);
          return {
            config,
            store: deps.authStore?.(c.env) ?? createAuthStore(c.var.getDb()),
            mailer:
              deps.mailer?.(c.env) ??
              (config.resendApiKey
                ? resendMailer({ apiKey: config.resendApiKey, from: config.emailFrom })
                : consoleMailer),
            limiter: deps.limiter?.(c.env) ?? rateLimiterFor(c.env),
            now: deps.now ?? (() => new Date()),
            audit: async (entry) => void (await writeAuditLog(c.var.getDb(), entry)),
          };
        })()),
    );
    await next();
  });

  app.route('/', health);
  app.route('/auth', createAuthRoutes());
  app.route(
    '/console',
    createConsoleRoutes({ tasks: deps.tasks, now: deps.now ?? (() => new Date()) }),
  );
  app.route(
    '/',
    createMetaRoutes({
      meta: deps.meta ?? defaultMetaFactory,
      now: deps.now ?? (() => new Date()),
      events: deps.events ?? ((env) => queuePublisher(env.EVENTS_QUEUE)),
    }),
  );

  app.onError(onError);
  app.notFound(notFound);
  return app;
}

export const app = createApp();
