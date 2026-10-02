import { decodeConnectResult } from '@fluvia/shared';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app';
import type { Bindings } from '../env';
import { CLIENT_ID, NOW, connectEnv, memoryEvents, memoryStore, mockMeta } from '../test-utils';

const AUTH = { authorization: `Bearer ${connectEnv.INTERNAL_API_TOKEN}` };

function setup(env: Bindings = connectEnv) {
  const memory = memoryStore();
  const events = memoryEvents();
  const app = createApp({
    events: () => events.publisher,
    getStore: () => memory.store,
    meta: (_env, token) => mockMeta(token),
    now: () => NOW,
  });
  const request = (path: string, init: RequestInit = {}) => app.request(path, init, env);
  const postLink = (body: unknown, headers: Record<string, string> = AUTH) =>
    request('/meta/connections/link', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  return { ...memory, events, request, postLink };
}

const location = (res: Response) => new URL(res.headers.get('location') ?? '');

describe('POST /meta/connections/link', () => {
  it('creates the link for a known client (201)', async () => {
    const { postLink, nonces } = setup();
    const res = await postLink({ clientId: CLIENT_ID });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { url: string; expiresAt: string };
    expect(body.url).toMatch(/^https:\/\/app\.fluvia\.test\/connect\?state=/);
    expect(body.expiresAt).toBe('2026-10-02T12:30:00.000Z');
    expect(nonces.has(CLIENT_ID)).toBe(true);
  });

  it('401 without the internal token, with a wrong one, or with another scheme', async () => {
    const { postLink, nonces } = setup();
    for (const headers of [
      {},
      { authorization: 'Bearer nope' },
      { authorization: `Basic ${connectEnv.INTERNAL_API_TOKEN}` },
    ]) {
      const res = await postLink({ clientId: CLIENT_ID }, headers);
      expect(res.status).toBe(401);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('unauthorized');
    }
    expect(nonces.size).toBe(0);
  });

  it('400 for an invalid body, 404 for an unknown client', async () => {
    const { postLink } = setup();
    expect((await postLink({ clientId: 'not-a-uuid' })).status).toBe(400);
    expect((await postLink({})).status).toBe(400);
    const unknown = await postLink({ clientId: '11111111-1111-4111-8111-111111111111' });
    expect(unknown.status).toBe(404);
  });

  it('503 not_configured, naming the variables but never their values', async () => {
    const rest = { ...(connectEnv as unknown as Record<string, string>) };
    delete rest.INTERNAL_API_TOKEN;
    const { postLink } = setup(rest as unknown as Bindings);
    const res = await postLink({ clientId: CLIENT_ID });
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text).error.code).toBe('not_configured');
    expect(text).not.toContain(connectEnv.OAUTH_STATE_SECRET as string);
  });
});

describe('GET /meta/login', () => {
  it('redirects a valid state onward (mock: straight to our callback) and keeps it out of caches', async () => {
    const { postLink, request } = setup();
    const link = (await (await postLink({ clientId: CLIENT_ID })).json()) as { url: string };
    const state = new URL(link.url).searchParams.get('state') ?? '';

    const res = await request(`/meta/login?state=${encodeURIComponent(state)}`);
    expect(res.status).toBe(302);
    expect(location(res).pathname).toBe('/meta/callback');
    expect(location(res).searchParams.get('state')).toBe(state);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it.each(['/meta/login', '/meta/login?state=garbage', `/meta/login?state=${'x'.repeat(3000)}`])(
    'sends %s to the web as an invalid link',
    async (path) => {
      const { request } = setup();
      const res = await request(path);
      expect(res.status).toBe(302);
      expect(location(res).origin).toBe('https://app.fluvia.test');
      expect(location(res).pathname).toBe('/connect/result');
      expect(decodeConnectResult(location(res).search).status).toBe('invalid_state');
    },
  );
});

describe('GET /meta/callback', () => {
  async function freshState(ctx: ReturnType<typeof setup>) {
    const link = (await (await ctx.postLink({ clientId: CLIENT_ID })).json()) as { url: string };
    return new URL(link.url).searchParams.get('state') ?? '';
  }

  it('full mock flow: link -> login -> callback -> result page with status=ok', async () => {
    const ctx = setup();
    const state = await freshState(ctx);

    const login = await ctx.request(`/meta/login?state=${encodeURIComponent(state)}`);
    const callbackUrl = location(login);
    const callback = await ctx.request(`${callbackUrl.pathname}${callbackUrl.search}`);

    expect(callback.status).toBe(302);
    expect(location(callback).origin + location(callback).pathname).toBe(
      'https://app.fluvia.test/connect/result',
    );
    expect(location(callback).search).toBe('?status=ok');
    expect(callback.headers.get('cache-control')).toBe('no-store');
    expect(ctx.outcomes[0]).toMatchObject({
      kind: 'saved',
      status: 'pending',
      pageId: '100000000000001',
    });
  });

  it('never puts tokens, page names or ids in the result URL', async () => {
    const ctx = setup();
    const state = await freshState(ctx);
    const res = await ctx.request(
      `/meta/callback?code=mock_code&state=${encodeURIComponent(state)}`,
    );
    const url = res.headers.get('location') ?? '';
    for (const secret of ['MOCK_USER_TOKEN', '100000000000001', 'Peluquer', 'code=']) {
      expect(url).not.toContain(secret);
    }
  });

  it('a replayed callback ends on the "invalid link" page', async () => {
    const ctx = setup();
    const state = await freshState(ctx);
    const path = `/meta/callback?code=c&state=${encodeURIComponent(state)}`;
    await ctx.request(path);
    const second = await ctx.request(path);
    expect(decodeConnectResult(location(second).search).status).toBe('invalid_state');
  });

  it('the client cancelling lands on "cancelled" with a retry state', async () => {
    const ctx = setup();
    const state = await freshState(ctx);
    const res = await ctx.request(
      `/meta/callback?error=access_denied&state=${encodeURIComponent(state)}`,
    );
    const result = decodeConnectResult(location(res).search);
    expect(result.status).toBe('cancelled');
    expect(result.retryState).toBeTruthy();
  });

  it.each([
    '/meta/callback',
    '/meta/callback?state=nope&code=x',
    `/meta/callback?code=${'a'.repeat(3000)}&state=x`,
  ])(
    'handles the malformed request %s as an invalid link, never as an error page',
    async (path) => {
      const res = await setup().request(path);
      expect(res.status).toBe(302);
      expect(decodeConnectResult(location(res).search).status).toBe('invalid_state');
    },
  );
});

describe('when something unexpected breaks during the callback', () => {
  it('still ends on the web result page (never a JSON error in the browser)', async () => {
    const memory = memoryStore();
    const broken = {
      ...memory.store,
      consumeNonce: async () => {
        throw new Error('database is down: postgres://user:secret@host/db');
      },
    };
    const app = createApp({
      getStore: () => broken,
      meta: (_env, token) => mockMeta(token),
      now: () => NOW,
    });
    const { signState } = await import('../oauth-state');
    const state = await signState(connectEnv.OAUTH_STATE_SECRET as string, {
      cid: CLIENT_ID,
      nonce: 'n'.repeat(22),
      exp: NOW.getTime() / 1000 + 600,
    });

    const res = await app.request(
      `/meta/callback?code=c&state=${encodeURIComponent(state)}`,
      {},
      connectEnv,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://app.fluvia.test/connect/result?status=error');
    expect(res.headers.get('location')).not.toContain('secret');
  });
});

describe('POST /meta/connections/:clientId/process', () => {
  const call = (
    ctx: ReturnType<typeof setup>,
    clientId: string,
    body?: string,
    headers: Record<string, string> = AUTH,
  ) =>
    ctx.request(`/meta/connections/${clientId}/process`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body }),
    });

  it('queues a re-run (202), with no body', async () => {
    const ctx = setup();
    const res = await call(ctx, CLIENT_ID);
    expect(res.status).toBe(202);
    const { queued, eventId } = (await res.json()) as { queued: boolean; eventId: string };
    expect(queued).toBe(true);
    expect(ctx.events.published).toEqual([
      {
        id: eventId,
        type: 'meta.connection.received',
        occurredAt: NOW.toISOString(),
        clientId: CLIENT_ID,
        acknowledged: [],
      },
    ]);
  });

  it('passes along what a person verified by hand', async () => {
    const ctx = setup();
    const res = await call(ctx, CLIENT_ID, JSON.stringify({ acknowledged: ['WA_VERIFY_MANUAL'] }));
    expect(res.status).toBe(202);
    expect(ctx.events.published[0]).toMatchObject({ acknowledged: ['WA_VERIFY_MANUAL'] });
  });

  it('refuses to acknowledge anything that can really be checked (400)', async () => {
    const ctx = setup();
    for (const code of ['PAGE_RESTRICTED', 'IG_NOT_PROFESSIONAL', 'whatever']) {
      const res = await call(ctx, CLIENT_ID, JSON.stringify({ acknowledged: [code] }));
      expect(res.status, code).toBe(400);
    }
    expect(ctx.events.published).toEqual([]);
  });

  it('401 without the internal token, 400 for a bad id or body, 404 for an unknown client', async () => {
    const ctx = setup();
    expect((await call(ctx, CLIENT_ID, undefined, {})).status).toBe(401);
    expect((await call(ctx, CLIENT_ID, undefined, { authorization: 'Bearer nope' })).status).toBe(
      401,
    );
    expect((await call(ctx, 'not-a-uuid')).status).toBe(400);
    expect((await call(ctx, CLIENT_ID, '{not json')).status).toBe(400);
    expect((await call(ctx, '11111111-1111-4111-8111-111111111111')).status).toBe(404);
    expect(ctx.events.published).toEqual([]);
  });

  it('503 when the queue is down (so the person knows to try again)', async () => {
    const ctx = setup();
    ctx.events.state.failNext = true;
    expect((await call(ctx, CLIENT_ID)).status).toBe(503);
  });
});
