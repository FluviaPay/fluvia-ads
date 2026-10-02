import { createMetaClient, type MetaClient } from '@fluvia/meta';
import type { ConnectResult } from '@fluvia/shared';
import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { safeEqual } from '../encoding';
import type { AppEnv, Bindings } from '../env';
import { log } from '../logger';
import { resolveConnectConfig } from '../meta/config';
import {
  createConnectionLink,
  handleCallback,
  resultUrl,
  startLogin,
  type ConnectDeps,
} from '../meta/connect';
import { parseBody } from '../validate';

export type MetaFactory = (env: Bindings, userToken?: string) => MetaClient;

export const defaultMetaFactory: MetaFactory = (env, userToken) =>
  createMetaClient(env, userToken ? { token: userToken } : {});

const linkBody = z.object({ clientId: z.uuid() });

const browserQuery = z.object({
  state: z.string().max(2048).optional(),
  code: z.string().max(2048).optional(),
  error: z.string().max(200).optional(),
});

export function createMetaRoutes(options: { meta: MetaFactory; now: () => Date }) {
  const routes = new Hono<AppEnv>();

  const depsFor = (c: Context<AppEnv>): ConnectDeps => ({
    config: resolveConnectConfig(c.env),
    store: c.var.getStore(),
    meta: (token) => options.meta(c.env, token),
    now: options.now,
    requestId: c.get('requestId'),
  });

  /** These URLs carry `state`/`code`: keep them out of caches and Referer headers. */
  const sensitive = (c: Context<AppEnv>) => {
    c.header('Cache-Control', 'no-store');
    c.header('Referrer-Policy', 'no-referrer');
  };

  // Called by Fluvia's own backend (portal, Kapso flow), never by a browser. There is no
  // user authentication yet, so a shared secret protects it: without it anyone could attach
  // their page to someone else's client.
  routes.post('/meta/connections/link', async (c) => {
    const deps = depsFor(c);
    const bearer = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '')?.[1];
    if (!bearer || !(await safeEqual(bearer, deps.config.internalToken))) {
      throw new HTTPException(401, { message: 'Unauthorized' });
    }
    const { clientId } = await parseBody(c, linkBody);
    const link = await createConnectionLink(deps, clientId);
    if (!link) throw new HTTPException(404, { message: 'Client not found' });
    log('info', 'meta_connect_link_created', {
      request_id: c.get('requestId'),
      client_id: clientId,
    });
    return c.json({ url: link.url, expiresAt: link.expiresAt.toISOString() }, 201);
  });

  routes.get('/meta/login', async (c) => {
    sensitive(c);
    const deps = depsFor(c);
    const query = browserQuery.safeParse(c.req.query());
    const state = query.success ? query.data.state : undefined;
    const start = state ? await startLogin(deps, state) : ({ ok: false } as const);
    return c.redirect(
      start.ok
        ? start.redirectTo
        : resultUrl(deps.config, { status: 'invalid_state', reasons: [] }),
      302,
    );
  });

  routes.get('/meta/callback', async (c) => {
    sensitive(c);
    const deps = depsFor(c);
    const query = browserQuery.safeParse(c.req.query());
    let result: ConnectResult = { status: 'invalid_state', reasons: [] };
    if (query.success) {
      try {
        result = await handleCallback(deps, query.data);
      } catch (err) {
        // A browser is waiting: always end on a page it can show. If this happened before the
        // nonce was consumed (e.g. the database was down) the same link still works.
        log('error', 'meta_callback_failed', {
          request_id: c.get('requestId'),
          error: err instanceof Error ? err.name : 'unknown',
        });
        result = { status: 'error', reasons: [] };
      }
    }
    log('info', 'meta_connect_callback', { request_id: c.get('requestId'), status: result.status });
    return c.redirect(resultUrl(deps.config, result), 302);
  });

  return routes;
}
