import { MetaApiError } from '@fluvia/meta';
import { decodeConnectResult } from '@fluvia/shared';
import { describe, expect, it } from 'vitest';
import { decryptToken } from '../crypto';
import { signState, verifyState } from '../oauth-state';
import {
  CLIENT_ID,
  NOW,
  connectEnv,
  jsonResponse,
  memoryStore,
  metaFromFetch,
  mockMeta,
  routedFetch,
} from '../test-utils';
import { resolveConnectConfig } from './config';
import { createConnectionLink, handleCallback, startLogin, type ConnectDeps } from './connect';

const MOCK_TOKEN = 'MOCK_USER_TOKEN_not_a_real_token';

function setup(overrides: Partial<ConnectDeps> = {}, clock = { now: NOW }) {
  const memory = memoryStore();
  const deps: ConnectDeps = {
    config: resolveConnectConfig(connectEnv),
    store: memory.store,
    meta: mockMeta,
    now: () => clock.now,
    ...overrides,
  };
  return { ...memory, deps, clock };
}

async function newState(deps: ConnectDeps) {
  const link = await createConnectionLink(deps, CLIENT_ID);
  return new URL(link?.url ?? '').searchParams.get('state') ?? '';
}

describe('createConnectionLink', () => {
  it('returns a web URL with a signed, 30-minute, single-use state and stores its nonce', async () => {
    const { deps, nonces } = setup();
    const link = await createConnectionLink(deps, CLIENT_ID);
    expect(link?.url).toMatch(/^https:\/\/app\.fluvia\.test\/connect\?state=/);

    const state = new URL(link?.url ?? '').searchParams.get('state') ?? '';
    const verified = await verifyState(deps.config.stateSecret, state, NOW.getTime() / 1000);
    expect(verified).toMatchObject({ ok: true, payload: { cid: CLIENT_ID } });
    expect(verified.ok && verified.payload.exp).toBe(NOW.getTime() / 1000 + 1800);
    expect(nonces.get(CLIENT_ID)?.nonce).toBe(verified.ok ? verified.payload.nonce : '');
    expect(link?.expiresAt.toISOString()).toBe('2026-10-02T12:30:00.000Z');
  });

  it('returns null, and stores nothing, for an unknown client', async () => {
    const { deps, nonces } = setup();
    expect(await createConnectionLink(deps, '11111111-1111-4111-8111-111111111111')).toBeNull();
    expect(nonces.size).toBe(0);
  });

  it('a new link invalidates the previous one', async () => {
    const { deps } = setup();
    const first = await newState(deps);
    await newState(deps);
    expect(await handleCallback(deps, { state: first, code: 'c' })).toMatchObject({
      status: 'invalid_state',
    });
  });
});

describe('startLogin', () => {
  it('mock mode skips Facebook and goes straight to our callback', async () => {
    const { deps } = setup();
    const state = await newState(deps);
    const start = await startLogin(deps, state);
    expect(start.ok && new URL(start.redirectTo).origin).toBe('https://api.fluvia.test');
    const url = new URL(start.ok ? start.redirectTo : '');
    expect(url.pathname).toBe('/meta/callback');
    expect(url.searchParams.get('code')).toBe('mock_code');
    expect(url.searchParams.get('state')).toBe(state);
  });

  it('sandbox/live send the browser to the Login for Business dialog', async () => {
    const config = resolveConnectConfig({
      ...connectEnv,
      META_MODE: 'sandbox',
      META_SYSTEM_USER_TOKEN: 'EAASYSTEMTOKEN',
      META_SANDBOX_AD_ACCOUNT_ID: '555',
      META_APP_ID: 'APP1',
      META_APP_SECRET: 'SECRET1',
      META_LOGIN_CONFIG_ID: 'CFG1',
    });
    const { deps } = setup({ config });
    const state = await newState(deps);
    const start = await startLogin(deps, state);
    const url = new URL(start.ok ? start.redirectTo : 'about:blank');
    expect(`${url.origin}${url.pathname}`).toBe('https://www.facebook.com/v26.0/dialog/oauth');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'APP1',
      config_id: 'CFG1',
      redirect_uri: 'https://api.fluvia.test/meta/callback',
      state,
    });
    expect(url.search).not.toContain('SECRET1');
  });

  it('rejects an invalid, tampered or expired state', async () => {
    const clock = { now: NOW };
    const { deps } = setup({}, clock);
    const state = await newState(deps);
    expect(await startLogin(deps, 'garbage')).toEqual({ ok: false });
    expect(await startLogin(deps, `${state}x`)).toEqual({ ok: false });
    clock.now = new Date(NOW.getTime() + 31 * 60_000);
    expect(await startLogin(deps, state)).toEqual({ ok: false });
  });
});

describe('handleCallback (mock Meta)', () => {
  it('saves the connection: page, Instagram, permissions and the token ENCRYPTED', async () => {
    const { deps, outcomes } = setup();
    const state = await newState(deps);

    const result = await handleCallback(deps, { state, code: 'mock_code' });
    expect(result).toEqual({ status: 'ok', reasons: [] });

    expect(outcomes).toHaveLength(1);
    const saved = outcomes[0];
    expect(saved).toMatchObject({
      kind: 'saved',
      clientId: CLIENT_ID,
      status: 'pending',
      pageId: '100000000000001',
      igId: '17841400000000001',
      reasons: [],
      retry: null,
      tokenExpiresAt: new Date(NOW.getTime() + 5_184_000 * 1000),
    });
    expect(saved?.kind === 'saved' && saved.permissions).toContain('ads_management');

    // Encrypted, bound to this client, and the plaintext appears nowhere in the outcome.
    const encrypted = saved?.kind === 'saved' ? saved.encryptedToken : '';
    expect(encrypted).toMatch(/^v1\./);
    expect(JSON.stringify(saved)).not.toContain(MOCK_TOKEN);
    expect(
      await decryptToken(deps.config.tokenKey, encrypted, `meta_connections:${CLIENT_ID}`),
    ).toBe(MOCK_TOKEN);
  });

  it('a state works only once (replay protection)', async () => {
    const { deps, outcomes } = setup();
    const state = await newState(deps);
    expect(await handleCallback(deps, { state, code: 'c' })).toMatchObject({ status: 'ok' });
    expect(await handleCallback(deps, { state, code: 'c' })).toEqual({
      status: 'invalid_state',
      reasons: [],
    });
    expect(outcomes.map((o) => o.kind)).toEqual(['saved', 'rejected']);
  });

  it('rejects an expired state without touching the store', async () => {
    const clock = { now: NOW };
    const { deps, outcomes } = setup({}, clock);
    const state = await newState(deps);
    clock.now = new Date(NOW.getTime() + 31 * 60_000);
    expect(await handleCallback(deps, { state, code: 'c' })).toMatchObject({
      status: 'invalid_state',
    });
    expect(outcomes).toEqual([]);
  });

  it('rejects forged states: nothing is saved, no client is trusted', async () => {
    const { deps, outcomes } = setup();
    const forged = await signState('x'.repeat(40), {
      cid: CLIENT_ID,
      nonce: 'n'.repeat(22),
      exp: NOW.getTime() / 1000 + 600,
    });
    for (const state of [forged, 'garbage', '', undefined]) {
      expect(await handleCallback(deps, { state, code: 'c' })).toEqual({
        status: 'invalid_state',
        reasons: [],
      });
    }
    expect(outcomes).toEqual([]);
  });

  it('a validly signed state with an unknown nonce is rejected (and audited)', async () => {
    const { deps, outcomes } = setup();
    const state = await signState(deps.config.stateSecret, {
      cid: CLIENT_ID,
      nonce: 'z'.repeat(22),
      exp: NOW.getTime() / 1000 + 600,
    });
    expect(await handleCallback(deps, { state, code: 'c' })).toMatchObject({
      status: 'invalid_state',
    });
    expect(outcomes).toEqual([
      { kind: 'rejected', clientId: CLIENT_ID, reason: 'reused_or_expired' },
    ]);
  });

  it('the client cancelling is recorded without a task, and offers a one-time retry link', async () => {
    const { deps, outcomes } = setup();
    const state = await newState(deps);
    const result = await handleCallback(deps, { state, error: 'access_denied' });
    expect(result).toMatchObject({ status: 'cancelled', reasons: [] });
    expect(outcomes[0]).toMatchObject({ kind: 'cancelled', clientId: CLIENT_ID });

    // The retry state works exactly once.
    const retry = result.retryState ?? '';
    expect(await handleCallback(deps, { state: retry, code: 'c' })).toMatchObject({ status: 'ok' });
    expect(await handleCallback(deps, { state: retry, code: 'c' })).toMatchObject({
      status: 'invalid_state',
    });
  });

  it('a callback without a code is an error with a retry link', async () => {
    const { deps, outcomes } = setup();
    const result = await handleCallback(deps, { state: await newState(deps) });
    expect(result).toMatchObject({ status: 'error' });
    expect(result.retryState).toBeTruthy();
    expect(outcomes[0]).toMatchObject({ kind: 'failed', reason: 'missing_code' });
  });
});

describe('handleCallback (scripted Meta)', () => {
  const PAGE = { id: '100000000000001', name: 'Mi Página' };
  const allPermissions = [
    'ads_management',
    'ads_read',
    'business_management',
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_ads',
    'instagram_basic',
  ].map((permission) => ({ permission, status: 'granted' }));

  const exchange = () => jsonResponse({ access_token: 'USER_TOKEN_123', expires_in: 3600 });
  const pages = (list: object[]) => () => jsonResponse({ data: list });
  const permissions =
    (list: object[] = allPermissions) =>
    () =>
      jsonResponse({ data: list });
  const noInstagram = () => jsonResponse({ id: PAGE.id });
  const graphError = (code: number) => () =>
    jsonResponse({ error: { message: 'm', type: 'OAuthException', code } }, 400);

  async function run(routes: Record<string, () => Response | Error>) {
    const script = routedFetch(routes);
    const { deps, outcomes } = setup({ meta: metaFromFetch(script.fetch) });
    const result = await handleCallback(deps, { state: await newState(deps), code: 'THE_CODE' });
    return { result, outcomes, calls: script.calls, deps };
  }

  it('needs_action when the user is not an admin and the page is unpublished: all reasons at once', async () => {
    const { result, outcomes } = await run({
      'GET /oauth/access_token': exchange,
      'GET /me/accounts': pages([{ ...PAGE, tasks: ['ANALYZE'], is_published: false }]),
      'GET /me/permissions': permissions(),
      [`GET /${PAGE.id}`]: noInstagram,
    });
    expect(result.status).toBe('needs_action');
    expect([...result.reasons].sort()).toEqual(['PAGE_NOT_ADMIN', 'PAGE_UNPUBLISHED']);
    expect(result.retryState).toBeTruthy();
    expect(outcomes[0]).toMatchObject({
      kind: 'saved',
      status: 'needs_action',
      pageId: PAGE.id,
      igId: null,
    });
  });

  it('needs_action when permissions were only partly granted', async () => {
    const { result } = await run({
      'GET /oauth/access_token': exchange,
      'GET /me/accounts': pages([{ ...PAGE, tasks: ['MANAGE', 'ADVERTISE'] }]),
      'GET /me/permissions': permissions([{ permission: 'ads_read', status: 'granted' }]),
      [`GET /${PAGE.id}`]: noInstagram,
    });
    expect(result).toMatchObject({ status: 'needs_action', reasons: ['PERMISSIONS_MISSING'] });
  });

  it('NO_PAGE when the user granted no page (page and Instagram stay null)', async () => {
    const { result, outcomes } = await run({
      'GET /oauth/access_token': exchange,
      'GET /me/accounts': pages([]),
      'GET /me/permissions': permissions(),
    });
    expect(result).toMatchObject({ status: 'needs_action', reasons: ['NO_PAGE'] });
    expect(outcomes[0]).toMatchObject({ pageId: null, igId: null });
  });

  it('MULTIPLE_PAGES when more than one page was authorised: a human decides', async () => {
    const { result, outcomes } = await run({
      'GET /oauth/access_token': exchange,
      'GET /me/accounts': pages([
        { ...PAGE, tasks: ['MANAGE'] },
        { id: '100000000000002', name: 'Otra', tasks: ['MANAGE'] },
      ]),
      'GET /me/permissions': permissions(),
    });
    expect(result).toMatchObject({ status: 'needs_action', reasons: ['MULTIPLE_PAGES'] });
    expect(outcomes[0]).toMatchObject({ kind: 'saved', status: 'needs_action', pageId: null });
  });

  it("uses the client's own token for reads and no Authorization for the code exchange", async () => {
    const { calls } = await run({
      'GET /oauth/access_token': exchange,
      'GET /me/accounts': pages([{ ...PAGE, tasks: ['MANAGE', 'ADVERTISE'], is_published: true }]),
      'GET /me/permissions': permissions(),
      [`GET /${PAGE.id}`]: () =>
        jsonResponse({ id: PAGE.id, instagram_business_account: { id: '17841400000000009' } }),
    });
    expect(
      calls.find((c) => c.key === 'GET /oauth/access_token')?.headers.authorization,
    ).toBeUndefined();
    for (const call of calls.filter((c) => c.key !== 'GET /oauth/access_token')) {
      expect(call.headers.authorization).toBe('Bearer USER_TOKEN_123');
    }
  });

  it('a refused code exchange is an error: no token saved, task + retry link', async () => {
    const { result, outcomes } = await run({ 'GET /oauth/access_token': graphError(100) });
    expect(result).toMatchObject({ status: 'error' });
    expect(result.retryState).toBeTruthy();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({
      kind: 'failed',
      reason: 'token_exchange:invalid_request:100',
    });
    expect(JSON.stringify(outcomes)).not.toContain('encryptedToken');
  });

  it('a token Meta rejects while reading the pages is an error, not a half-saved connection', async () => {
    const { result, outcomes } = await run({
      'GET /oauth/access_token': exchange,
      'GET /me/accounts': graphError(190),
    });
    expect(result.status).toBe('error');
    expect(outcomes).toEqual([
      expect.objectContaining({ kind: 'failed', reason: 'meta_read:auth:190' }),
    ]);
  });

  it('network failures reaching Meta also end as an error, never as an exception', async () => {
    const { result, outcomes } = await run({
      'GET /oauth/access_token': () => new TypeError('offline'),
    });
    expect(result.status).toBe('error');
    expect(outcomes[0]).toMatchObject({ kind: 'failed' });
  });

  it("failure reasons carry category and code only, never Meta's message", async () => {
    const { outcomes } = await run({
      'GET /oauth/access_token': () =>
        jsonResponse({ error: { message: 'secret detail about Juan Pérez', code: 100 } }, 400),
    });
    expect(JSON.stringify(outcomes)).not.toContain('Juan');
  });

  it('sanity: the typed error Meta gives is a MetaApiError', async () => {
    const script = routedFetch({ 'GET /oauth/access_token': graphError(100) });
    await expect(metaFromFetch(script.fetch)().get('/oauth/access_token')).rejects.toBeInstanceOf(
      MetaApiError,
    );
  });

  it('what the result carries is decodable by the web', async () => {
    const { result } = await run({
      'GET /oauth/access_token': exchange,
      'GET /me/accounts': pages([]),
      'GET /me/permissions': permissions(),
    });
    expect(
      decodeConnectResult(`status=${result.status}&reasons=${result.reasons.join(',')}`),
    ).toMatchObject({
      status: 'needs_action',
      reasons: ['NO_PAGE'],
    });
  });
});
