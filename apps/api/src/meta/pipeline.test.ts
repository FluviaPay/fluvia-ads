import { MetaApiError, MetaNetworkError } from '@fluvia/meta';
import { describe, expect, it } from 'vitest';
import { encryptToken } from '../crypto';
import {
  CLIENT_ID,
  NOW,
  connectEnv,
  jsonResponse,
  memoryEvents,
  memoryLock,
  memorySetupStore,
  metaFromFetch,
  mockMeta,
  routedFetch,
} from '../test-utils';
import { MAX_ATTEMPTS, classifyFailure, processConnection, type PipelineDeps } from './pipeline';
import type { SetupContext } from './setup-store';

const KEY = connectEnv.TOKEN_ENCRYPTION_KEY as string;
const PAGE = '100000000000001';
const BUSINESS = '1100000000000001';
const ACCOUNT = 'act_2000000000000002';
const SETUP = {
  ok: true as const,
  config: {
    businessId: BUSINESS,
    systemUserId: '1200000000000001',
    timezoneId: 99,
    endAdvertiser: 'NONE',
    mediaAgency: 'NONE',
    partner: 'NONE',
  },
};

const permissions = [
  'ads_management',
  'ads_read',
  'business_management',
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_ads',
  'instagram_basic',
  'whatsapp_business_management',
].map((permission) => ({ permission, status: 'granted' }));

const account = (name = `FLV_${CLIENT_ID}`, currency = 'COP') => ({
  id: ACCOUNT,
  account_id: '2000000000000002',
  name,
  account_status: 1,
  currency,
  timezone_name: 'America/Bogota',
});

type Routes = Record<string, (call: { query: URLSearchParams }) => Response | Error>;

/** Everything works: the baseline each test breaks one piece of. */
const goodRoutes = (): Routes => ({
  'GET /me/permissions': () => jsonResponse({ data: permissions }),
  'GET /me/accounts': () =>
    jsonResponse({
      data: [{ id: PAGE, name: 'P', tasks: ['MANAGE', 'ADVERTISE'], is_published: true }],
    }),
  [`GET /${PAGE}`]: () =>
    jsonResponse({
      id: PAGE,
      instagram_business_account: { id: '17841400000000001' },
      whatsapp_number: '+573001112233',
    }),
  [`GET /${BUSINESS}/owned_ad_accounts`]: () => jsonResponse({ data: [] }),
  [`POST /${BUSINESS}/adaccount`]: () => jsonResponse({ id: ACCOUNT }),
  [`GET /${ACCOUNT}`]: () => jsonResponse(account()),
  [`POST /${BUSINESS}/client_pages`]: () => jsonResponse({ success: true }),
  [`POST /${PAGE}/assigned_users`]: () => jsonResponse({ success: true }),
  [`POST /${ACCOUNT}/adcreatives`]: () => jsonResponse({ id: '1' }),
});

const graphError = (code: number, status = 400, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error: { message: 'm', type: 'OAuthException', code } }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

type Overrides = {
  routes?: Routes;
  connection?: Partial<SetupContext['connection']>;
  setup?: PipelineDeps['setup'];
  now?: Date;
};

async function setup(overrides: Overrides = {}) {
  const encryptedToken = await encryptToken(KEY, 'USER_TOKEN_123', `meta_connections:${CLIENT_ID}`);
  const memory = memorySetupStore({ encryptedToken, ...overrides.connection });
  const events = memoryEvents();
  const lock = memoryLock();
  const script = routedFetch({ ...goodRoutes(), ...overrides.routes });
  const deps: PipelineDeps = {
    store: memory.store,
    meta: metaFromFetch(script.fetch),
    lock: lock.lock,
    events: events.publisher,
    setup: overrides.setup ?? SETUP,
    tokenKey: KEY,
    webBaseUrl: 'https://app.fluvia.test',
    now: () => overrides.now ?? NOW,
    newId: () => '5b1a2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
  };
  const run = (extra: { acknowledged?: string[]; attempt?: number } = {}) =>
    processConnection(deps, {
      clientId: CLIENT_ID,
      acknowledged: new Set(extra.acknowledged ?? []),
      attempt: extra.attempt ?? 1,
    });
  const called = (key: string) => script.calls.filter((c) => c.key === key).length;
  return { ...memory, events, lock, script, deps, run, called };
}

const codesOf = (tasks: { payload: Record<string, unknown> }[]) => tasks.map((t) => t.payload.code);

describe('processConnection: the happy path', () => {
  it('validates, creates the account, assigns the page, probes, connects and publishes meta.connected', async () => {
    const t = await setup();
    expect(await t.run()).toEqual({ kind: 'connected' });

    expect(t.state.connection).toMatchObject({
      status: 'connected',
      adAccountId: ACCOUNT,
      igId: '17841400000000001',
    });
    expect(t.state.connection.pageAssignedAt).toEqual(NOW);
    expect(t.tasks).toEqual([]);
    expect(t.audit.map((a) => a.action)).toEqual([
      'meta.setup.ad_account_saved',
      'meta.setup.page_assigned',
      'meta.connected',
    ]);

    expect(t.events.published).toEqual([
      {
        id: '5b1a2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
        type: 'meta.connected',
        occurredAt: NOW.toISOString(),
        clientId: CLIENT_ID,
        idempotencyKey: `meta.connected:${CLIENT_ID}:${ACCOUNT}`,
        data: {
          adAccountId: ACCOUNT,
          pageId: PAGE,
          igId: '17841400000000001',
          // Nothing chose destinations yet: the template defaults apply.
          messageDestinations: ['whatsapp', 'instagram_direct'],
        },
      },
    ]);
    expect(t.lock.held.size).toBe(0);
  });

  it('works end to end against the recorded (mock) Meta responses too', async () => {
    const t = await setup();
    t.deps.meta = mockMeta;
    expect(await t.run()).toEqual({ kind: 'connected' });
    expect(t.state.connection.adAccountId).toBe('act_1000000000000001');
    expect(t.events.published).toHaveLength(1);
  });

  it('reads with the CLIENT token and writes with the SYSTEM user token', async () => {
    const t = await setup();
    await t.run();
    const auth = (key: string) => t.script.calls.find((c) => c.key === key)?.headers.authorization;
    expect(auth('GET /me/permissions')).toBe('Bearer USER_TOKEN_123');
    expect(auth(`GET /${PAGE}`)).toBe('Bearer USER_TOKEN_123');
    expect(auth(`GET /${BUSINESS}/owned_ad_accounts`)).toBe('Bearer EAASYSTEMTOKEN');
    expect(auth(`POST /${BUSINESS}/adaccount`)).toBe('Bearer EAASYSTEMTOKEN');
    expect(auth(`POST /${PAGE}/assigned_users`)).toBe('Bearer EAASYSTEMTOKEN');
  });

  it('runs the page probe only AFTER the account exists and the page is assigned', async () => {
    const t = await setup();
    await t.run();
    const order = t.script.calls.map((c) => c.key);
    const at = (key: string) => order.indexOf(key);
    expect(at(`POST /${BUSINESS}/adaccount`)).toBeLessThan(at(`POST /${BUSINESS}/client_pages`));
    expect(at(`POST /${PAGE}/assigned_users`)).toBeLessThan(at(`POST /${ACCOUNT}/adcreatives`));
  });

  it('a second run changes nothing in Meta and republishes the same idempotency key', async () => {
    const t = await setup();
    await t.run();
    const callsAfterFirst = t.script.calls.length;
    expect(await t.run()).toEqual({ kind: 'connected' });
    expect(t.script.calls).toHaveLength(callsAfterFirst);
    expect(t.events.published).toHaveLength(2);
    expect(
      new Set(t.events.published.map((e) => (e as { idempotencyKey: string }).idempotencyKey)).size,
    ).toBe(1);
  });

  it('uses the destinations chosen by the client when they exist', async () => {
    const t = await setup({ connection: { messageDestinations: ['messenger'] } });
    await t.run();
    expect(t.events.published[0]).toMatchObject({ data: { messageDestinations: ['messenger'] } });
  });
});

describe('processConnection: validations stop everything before any ad account is created', () => {
  const noWrites = (t: Awaited<ReturnType<typeof setup>>) => {
    expect(t.called(`POST /${BUSINESS}/adaccount`)).toBe(0);
    expect(t.events.published).toEqual([]);
    expect(t.state.connection.status).toBe('needs_action');
    expect(t.state.connection.adAccountId).toBeNull();
  };

  it('IG_NOT_PROFESSIONAL when Instagram Direct is a destination and the page has no professional account', async () => {
    const t = await setup({
      routes: { [`GET /${PAGE}`]: () => jsonResponse({ id: PAGE, whatsapp_number: '+57' }) },
    });
    expect(await t.run()).toEqual({ kind: 'needs_action', codes: ['IG_NOT_PROFESSIONAL'] });
    expect(codesOf(t.tasks)).toEqual(['IG_NOT_PROFESSIONAL']);
    noWrites(t);
  });

  it('WA_NOT_LINKED when WhatsApp is a destination and the page has no number', async () => {
    const t = await setup({
      routes: {
        [`GET /${PAGE}`]: () => jsonResponse({ id: PAGE, instagram_business_account: { id: '1' } }),
      },
    });
    expect(await t.run()).toEqual({ kind: 'needs_action', codes: ['WA_NOT_LINKED'] });
    noWrites(t);
  });

  it('the administrator check and the unpublished page are re-validated here too', async () => {
    const t = await setup({
      routes: {
        'GET /me/accounts': () =>
          jsonResponse({
            data: [{ id: PAGE, name: 'P', tasks: ['ANALYZE'], is_published: false }],
          }),
      },
    });
    const result = await t.run();
    expect(result.kind === 'needs_action' && [...result.codes].sort()).toEqual([
      'PAGE_NOT_ADMIN',
      'PAGE_UNPUBLISHED',
    ]);
    noWrites(t);
  });

  it('does not require Instagram or WhatsApp when the client chose only Messenger', async () => {
    const t = await setup({
      connection: { messageDestinations: ['messenger'] },
      routes: { [`GET /${PAGE}`]: () => jsonResponse({ id: PAGE }) },
    });
    expect(await t.run()).toEqual({ kind: 'connected' });
    expect(t.state.connection.igId).toBeNull();
  });

  it('WA_VERIFY_MANUAL when Meta will not let us read the link; a human can acknowledge it', async () => {
    const refused = ({ query }: { query: URLSearchParams }) =>
      query.get('fields') === 'whatsapp_number'
        ? graphError(100)
        : jsonResponse({ id: PAGE, instagram_business_account: { id: '1' } });
    const t = await setup({ routes: { [`GET /${PAGE}`]: refused } });

    expect(await t.run()).toEqual({ kind: 'needs_action', codes: ['WA_VERIFY_MANUAL'] });
    noWrites(t);
    expect(t.tasks[0]?.payload.instruction).toContain('{"acknowledged":["WA_VERIFY_MANUAL"]}');

    // The person checked: re-run with the acknowledgement.
    expect(await t.run({ acknowledged: ['WA_VERIFY_MANUAL'] })).toEqual({ kind: 'connected' });
    expect(t.audit.some((a) => a.action === 'meta.setup.acknowledged')).toBe(true);
  });

  it('an acknowledgement never excuses a failure that can really be checked', async () => {
    const t = await setup({
      routes: { [`GET /${PAGE}`]: () => jsonResponse({ id: PAGE, whatsapp_number: '+57' }) },
    });
    const result = await t.run({ acknowledged: ['WA_VERIFY_MANUAL', 'PAGE_ASSIGN_MANUAL'] });
    expect(result).toEqual({ kind: 'needs_action', codes: ['IG_NOT_PROFESSIONAL'] });
  });

  it('tasks carry the exact instruction, the ids and how to resume', async () => {
    const t = await setup({
      routes: { [`GET /${PAGE}`]: () => jsonResponse({ id: PAGE, whatsapp_number: '+57' }) },
    });
    await t.run();
    expect(t.tasks).toHaveLength(1);
    expect(t.tasks[0]).toMatchObject({
      type: 'meta.setup.IG_NOT_PROFESSIONAL',
      status: 'open',
      payload: {
        code: 'IG_NOT_PROFESSIONAL',
        clientId: CLIENT_ID,
        pageId: PAGE,
        retry: { method: 'POST', path: `/meta/connections/${CLIENT_ID}/process` },
      },
    });
    expect(t.tasks[0]?.payload.instruction).toContain('Peluquería Luna');
  });

  it('running it again does not pile up duplicate tasks', async () => {
    const t = await setup({
      routes: { [`GET /${PAGE}`]: () => jsonResponse({ id: PAGE, whatsapp_number: '+57' }) },
    });
    await t.run();
    await t.run();
    expect(t.tasks).toHaveLength(1);
  });

  it('once fixed, the next run connects and closes the open tasks automatically', async () => {
    const t = await setup({
      routes: { [`GET /${PAGE}`]: () => jsonResponse({ id: PAGE, whatsapp_number: '+57' }) },
    });
    await t.run();
    expect(t.tasks[0]?.status).toBe('open');

    // The client fixed their Instagram.
    t.script.calls.length = 0;
    const fixed = goodRoutes()[`GET /${PAGE}`] as () => Response;
    t.deps.meta = metaFromFetch(routedFetch({ ...goodRoutes(), [`GET /${PAGE}`]: fixed }).fetch);
    expect(await t.run()).toEqual({ kind: 'connected' });
    expect(t.tasks[0]?.status).toBe('done');
    expect(t.events.published).toHaveLength(1);
  });
});

describe('processConnection: ad account and page', () => {
  it('AD_ACCOUNT_CREATION_FAILED when Meta refuses to create it', async () => {
    const t = await setup({ routes: { [`POST /${BUSINESS}/adaccount`]: () => graphError(100) } });
    const result = await t.run();
    expect(result).toEqual({ kind: 'needs_action', codes: ['AD_ACCOUNT_CREATION_FAILED'] });
    expect(t.state.connection.adAccountId).toBeNull();
    expect(t.events.published).toEqual([]);
    expect(t.tasks[0]?.payload.detail).toBe('create:invalid_request:100');
  });

  it('AD_ACCOUNT_CONFLICT when the client already has an account that is not in COP', async () => {
    const t = await setup({
      routes: {
        [`GET /${BUSINESS}/owned_ad_accounts`]: () =>
          jsonResponse({ data: [account(undefined, 'USD')] }),
      },
    });
    expect(await t.run()).toEqual({ kind: 'needs_action', codes: ['AD_ACCOUNT_CONFLICT'] });
  });

  it('reuses an account that already exists (no second one is created)', async () => {
    const t = await setup({
      routes: { [`GET /${BUSINESS}/owned_ad_accounts`]: () => jsonResponse({ data: [account()] }) },
    });
    expect(await t.run()).toEqual({ kind: 'connected' });
    expect(t.called(`POST /${BUSINESS}/adaccount`)).toBe(0);
  });

  it('CONFIG_MISSING (after validations pass) when live settings are not provided: nothing is invented', async () => {
    const t = await setup({
      setup: { ok: false, missing: ['META_PARTNER', 'META_END_ADVERTISER'] },
    });
    expect(await t.run()).toEqual({ kind: 'needs_action', codes: ['CONFIG_MISSING'] });
    expect(t.tasks[0]?.payload.instruction).toContain('META_PARTNER, META_END_ADVERTISER');
    expect(t.called(`POST /${BUSINESS}/adaccount`)).toBe(0);
  });

  it('saves the account as soon as it exists, so a later failure never creates a second one', async () => {
    const t = await setup({
      routes: { [`POST /${BUSINESS}/client_pages`]: () => graphError(200, 403) },
    });
    expect(await t.run()).toEqual({ kind: 'needs_action', codes: ['PAGE_ASSIGN_MANUAL'] });
    expect(t.state.connection.adAccountId).toBe(ACCOUNT);
    expect(t.called(`POST /${BUSINESS}/adaccount`)).toBe(1);

    // After the human did it by hand: re-run with the acknowledgement. No second account.
    expect(await t.run({ acknowledged: ['PAGE_ASSIGN_MANUAL'] })).toEqual({ kind: 'connected' });
    expect(t.called(`POST /${BUSINESS}/adaccount`)).toBe(1);
    expect(t.state.connection.pageAssignedAt).toEqual(NOW);
    expect(
      t.audit.find(
        (a) =>
          a.action === 'meta.setup.page_assigned' &&
          (a.after as { how: string })?.how === 'acknowledged',
      ),
    ).toBeTruthy();
  });

  it('PAGE_ASSIGN_PENDING_CLIENT when the client has not approved the access yet', async () => {
    const t = await setup({
      routes: { [`POST /${PAGE}/assigned_users`]: () => graphError(200, 403) },
    });
    expect(await t.run()).toEqual({ kind: 'needs_action', codes: ['PAGE_ASSIGN_PENDING_CLIENT'] });
    expect(t.tasks[0]?.payload.instruction).toContain('Peluquería Luna');
    expect(t.state.connection.pageAssignedAt).toBeNull();
  });

  it('does not request the page again once the assignment worked', async () => {
    const t = await setup({ routes: { [`POST /${ACCOUNT}/adcreatives`]: () => graphError(368) } });
    expect(await t.run()).toEqual({ kind: 'needs_action', codes: ['PAGE_RESTRICTED'] });
    expect(t.called(`POST /${BUSINESS}/client_pages`)).toBe(1);
    expect(t.state.connection.pageAssignedAt).toEqual(NOW);

    // The restriction is lifted. The second run has its own Meta script: it must not
    // create another account nor ask for the page again.
    const second = routedFetch(goodRoutes());
    t.deps.meta = metaFromFetch(second.fetch);
    expect(await t.run()).toEqual({ kind: 'connected' });
    const keys = second.calls.map((c) => c.key);
    expect(keys).not.toContain(`POST /${BUSINESS}/client_pages`);
    expect(keys).not.toContain(`POST /${PAGE}/assigned_users`);
    expect(keys).not.toContain(`POST /${BUSINESS}/adaccount`);
    expect(keys).toContain(`POST /${ACCOUNT}/adcreatives`);
  });
});

describe('processConnection: page restrictions', () => {
  it('PAGE_RESTRICTED on a policy error, and an acknowledgement does not make it go away', async () => {
    const t = await setup({ routes: { [`POST /${ACCOUNT}/adcreatives`]: () => graphError(368) } });
    expect(await t.run()).toEqual({ kind: 'needs_action', codes: ['PAGE_RESTRICTED'] });
    expect(t.events.published).toEqual([]);
    expect(t.tasks[0]?.payload.detail).toBe('probe:policy:368');
  });

  it('PAGE_RESTRICTION_UNVERIFIED when Meta refuses for another reason; a human can acknowledge', async () => {
    const t = await setup({ routes: { [`POST /${ACCOUNT}/adcreatives`]: () => graphError(100) } });
    expect(await t.run()).toEqual({ kind: 'needs_action', codes: ['PAGE_RESTRICTION_UNVERIFIED'] });
    expect(await t.run({ acknowledged: ['PAGE_RESTRICTION_UNVERIFIED'] })).toEqual({
      kind: 'connected',
    });
  });
});

describe('processConnection: errors from Meta', () => {
  it('a rate limit goes back to the queue, waiting what Meta asked for', async () => {
    const usage = JSON.stringify({
      '1': [
        {
          type: 'ads_management',
          call_count: 100,
          total_cputime: 1,
          total_time: 1,
          estimated_time_to_regain_access: 5,
        },
      ],
    });
    const t = await setup({
      routes: {
        [`POST /${BUSINESS}/adaccount`]: () =>
          graphError(80004, 400, { 'x-business-use-case-usage': usage }),
      },
    });
    expect(await t.run()).toEqual({ kind: 'retry', delaySeconds: 300, reason: 'create_failed' });
    expect(t.tasks).toEqual([]);
  });

  it('transient errors and network failures retry with backoff, and are never a task at first', async () => {
    const t = await setup({ routes: { 'GET /me/permissions': () => graphError(2, 500) } });
    expect(await t.run({ attempt: 1 })).toMatchObject({ kind: 'retry', delaySeconds: 30 });
    expect(await t.run({ attempt: 3 })).toMatchObject({ kind: 'retry', delaySeconds: 120 });

    const net = await setup({ routes: { 'GET /me/permissions': () => new TypeError('offline') } });
    expect(await net.run()).toMatchObject({ kind: 'retry' });
    expect(net.tasks).toEqual([]);
  });

  it('when the retries are exhausted it becomes a technical task for the team', async () => {
    const t = await setup({ routes: { 'GET /me/permissions': () => graphError(2, 500) } });
    expect(await t.run({ attempt: MAX_ATTEMPTS })).toEqual({
      kind: 'needs_action',
      codes: ['SETUP_FAILED_TECHNICAL'],
    });
    expect(t.tasks[0]?.payload.detail).toBe('validate:retries_exhausted:transient');
  });

  it('a rejected client token (190) means the client must reconnect', async () => {
    const t = await setup({ routes: { 'GET /me/permissions': () => graphError(190) } });
    expect(await t.run()).toEqual({ kind: 'needs_action', codes: ['AUTH_EXPIRED'] });
    expect(t.tasks[0]?.payload.instruction).toContain('POST /meta/connections/link');
  });

  it("a rejected SYSTEM token is our problem, not the client's", async () => {
    const t = await setup({
      routes: { [`GET /${BUSINESS}/owned_ad_accounts`]: () => graphError(190) },
    });
    expect(await t.run()).toEqual({ kind: 'needs_action', codes: ['SETUP_FAILED_TECHNICAL'] });
  });

  it("task details carry category and code only, never Meta's message", async () => {
    const t = await setup({
      routes: {
        [`POST /${BUSINESS}/adaccount`]: () =>
          new Response(
            JSON.stringify({ error: { message: 'secret detail about Juan Pérez', code: 100 } }),
            { status: 400 },
          ),
      },
    });
    await t.run();
    expect(JSON.stringify(t.tasks)).not.toContain('Juan');
  });
});

describe('processConnection: the saved connection', () => {
  it('RECONNECT_REQUIRED without a page or a token', async () => {
    expect(await (await setup({ connection: { pageId: null } })).run()).toEqual({
      kind: 'needs_action',
      codes: ['RECONNECT_REQUIRED'],
    });
    expect(await (await setup({ connection: { encryptedToken: null } })).run()).toMatchObject({
      codes: ['RECONNECT_REQUIRED'],
    });
  });

  it('RECONNECT_REQUIRED when the stored token cannot be decrypted (wrong key or another client)', async () => {
    const t = await setup({ connection: { encryptedToken: 'v1.AAAA.BBBB' } });
    expect(await t.run()).toMatchObject({ codes: ['RECONNECT_REQUIRED'] });
    expect(t.called('GET /me/permissions')).toBe(0);
  });

  it('AUTH_EXPIRED when the stored token already expired, without calling Meta', async () => {
    const t = await setup({ connection: { tokenExpiresAt: new Date(NOW.getTime() - 1000) } });
    expect(await t.run()).toEqual({ kind: 'needs_action', codes: ['AUTH_EXPIRED'] });
    expect(t.script.calls).toHaveLength(0);
  });

  it('skips revoked connections and unknown clients', async () => {
    expect(await (await setup({ connection: { status: 'revoked' } })).run()).toEqual({
      kind: 'skipped',
      reason: 'revoked',
    });
    const t = await setup();
    t.deps.store.getContext = async () => null;
    expect(await t.run()).toEqual({ kind: 'skipped', reason: 'no_connection' });
  });
});

describe('processConnection: the per-client lock', () => {
  it('asks the queue to come back later when another run holds the lock', async () => {
    const t = await setup();
    await t.lock.lock.acquire(CLIENT_ID);
    expect(await t.run()).toEqual({ kind: 'retry', delaySeconds: 60, reason: 'locked' });
    expect(t.script.calls).toHaveLength(0);
  });

  it('gives up quietly if it is still locked at the last attempt (the other run owns the job)', async () => {
    const t = await setup();
    await t.lock.lock.acquire(CLIENT_ID);
    expect(await t.run({ attempt: MAX_ATTEMPTS })).toEqual({
      kind: 'skipped',
      reason: 'lock_busy',
    });
  });

  it('releases the lock even when something throws', async () => {
    const t = await setup();
    t.deps.store.getContext = async () => {
      throw new Error('database down');
    };
    await expect(t.run()).rejects.toThrow('database down');
    expect(t.lock.held.size).toBe(0);
  });

  it('two simultaneous runs create ONE ad account (the point of the lock)', async () => {
    const t = await setup();
    const [a, b] = await Promise.all([t.run(), t.run()]);
    expect([a.kind, b.kind].sort()).toEqual(['connected', 'retry']);
    expect(t.called(`POST /${BUSINESS}/adaccount`)).toBe(1);
  });
});

describe('classifyFailure', () => {
  const api = (status: number, code: number, headers: Record<string, string> = {}) =>
    new MetaApiError({ status, headers, body: { error: { message: 'm', code } } });

  it.each([
    ['validate', api(500, 2), 1, { action: 'retry', delaySeconds: 30 }],
    ['validate', api(500, 2), 2, { action: 'retry', delaySeconds: 60 }],
    ['validate', api(500, 2), 6, { action: 'task', code: 'SETUP_FAILED_TECHNICAL' }],
    ['create', api(400, 80004), 1, { action: 'retry', delaySeconds: 60 }],
    ['create', api(400, 80004), 6, { action: 'task', code: 'SETUP_FAILED_TECHNICAL' }],
    ['validate', api(400, 190), 1, { action: 'task', code: 'AUTH_EXPIRED' }],
    ['create', api(400, 190), 1, { action: 'task', code: 'SETUP_FAILED_TECHNICAL' }],
    ['create', api(403, 200), 1, { action: 'task', code: 'AD_ACCOUNT_CREATION_FAILED' }],
    ['assign', api(403, 200), 1, { action: 'task', code: 'SETUP_FAILED_TECHNICAL' }],
    ['probe', api(400, 368), 1, { action: 'task', code: 'SETUP_FAILED_TECHNICAL' }],
  ] as const)('%s / %#', (stage, err, attempt, expected) => {
    const decision = classifyFailure(stage, err, attempt, MAX_ATTEMPTS);
    expect(decision).toMatchObject(
      expected.action === 'retry' ? expected : { action: 'task', failure: { code: expected.code } },
    );
  });

  it('never waits less than 30 s or more than 15 min for a rate limit', () => {
    const usage = (minutes: number) => ({
      'x-business-use-case-usage': JSON.stringify({
        '1': [
          {
            type: 't',
            call_count: 1,
            total_cputime: 1,
            total_time: 1,
            estimated_time_to_regain_access: minutes,
          },
        ],
      }),
    });
    expect(classifyFailure('create', api(400, 80004, usage(0.1)), 1, 6)).toMatchObject({
      delaySeconds: 30,
    });
    expect(classifyFailure('create', api(400, 80004, usage(600)), 1, 6)).toMatchObject({
      delaySeconds: 900,
    });
  });

  it('treats network errors like transient ones, and unknown errors as technical', () => {
    expect(classifyFailure('validate', new MetaNetworkError(new Error('x')), 1, 6)).toMatchObject({
      action: 'retry',
    });
    expect(classifyFailure('validate', new Error('bug'), 1, 6)).toMatchObject({
      action: 'task',
      failure: { code: 'SETUP_FAILED_TECHNICAL', detail: 'validate:Error' },
    });
  });
});
