import { createMetaClient, type MetaClient } from '@fluvia/meta';
import { acknowledgeableCodeSchema, type ConnectResult } from '@fluvia/shared';
import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { safeEqual } from '../encoding';
import type { AppEnv, Bindings } from '../env';
import type { EventPublisher } from '../events';
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

const processBody = z.object({ acknowledged: z.array(acknowledgeableCodeSchema).default([]) });

const browserQuery = z.object({
  state: z.string().max(2048).optional(),
  code: z.string().max(2048).optional(),
  error: z.string().max(200).optional(),
});

export function createMetaRoutes(options: {
  meta: MetaFactory;
  now: () => Date;
  events: (env: Bindings) => EventPublisher;
}) {
  const routes = new Hono<AppEnv>();

  const depsFor = (c: Context<AppEnv>): ConnectDeps => ({
    config: resolveConnectConfig(c.env),
    store: c.var.getStore(),
    meta: (token) => options.meta(c.env, token),
    now: options.now,
    events: options.events(c.env),
    newId: () => crypto.randomUUID(),
    requestId: c.get('requestId'),
  });

  /** Fluvia's own backend only (no user authentication exists yet). */
  const requireInternal = async (c: Context<AppEnv>, deps: ConnectDeps) => {
    const bearer = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '')?.[1];
    if (!bearer || !(await safeEqual(bearer, deps.config.internalToken))) {
      throw new HTTPException(401, { message: 'Unauthorized' });
    }
  };

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
    await requireInternal(c, deps);
    const { clientId } = await parseBody(c, linkBody);
    const link = await createConnectionLink(deps, clientId);
    if (!link) throw new HTTPException(404, { message: 'Client not found' });
    log('info', 'meta_connect_link_created', {
      request_id: c.get('requestId'),
      client_id: clientId,
    });
    return c.json({ url: link.url, expiresAt: link.expiresAt.toISOString() }, 201);
  });

  // Re-runs the setup of a client (validate, ad account, page). Used by a person after
  // fixing what a task asked for; `acknowledged` declares what they verified by hand.
  routes.post('/meta/connections/:clientId/process', async (c) => {
    const deps = depsFor(c);
    await requireInternal(c, deps);

    const clientId = z.uuid().safeParse(c.req.param('clientId'));
    if (!clientId.success) throw new HTTPException(400, { message: 'Invalid client id' });

    const raw = (await c.req.text()).trim();
    let body: unknown = {};
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        throw new HTTPException(400, { message: 'Invalid JSON body' });
      }
    }
    const { acknowledged } = processBody.parse(body);

    if (!(await deps.store.clientExists(clientId.data))) {
      throw new HTTPException(404, { message: 'Client not found' });
    }
    const eventId = deps.newId();
    try {
      await deps.events.publish({
        id: eventId,
        type: 'meta.connection.received',
        occurredAt: deps.now().toISOString(),
        clientId: clientId.data,
        acknowledged,
      });
    } catch {
      throw new HTTPException(503, { message: 'The queue is unavailable, try again' });
    }
    log('info', 'meta_connection_reprocess_requested', {
      request_id: c.get('requestId'),
      client_id: clientId.data,
      acknowledged,
    });
    return c.json({ queued: true, eventId }, 202);
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
