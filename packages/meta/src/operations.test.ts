import { describe, expect, it } from 'vitest';
import {
  MetaApiError,
  MetaConflictError,
  MetaInputError,
  MetaNetworkError,
  MetaPaginationLimitError,
  MetaSchemaError,
  assignPageToAdAccount,
  checkPagePermissions,
  createAdAccount,
  createMetaClient,
  getAdAccount,
  getInstagramAccount,
  getPages,
  type MetaEnv,
} from './index';
import { graphError, json, liveClient, scriptedFetch } from './test-utils';

const mock = (scenario = 'happy'): MetaEnv => ({ META_MODE: 'mock', META_MOCK_SCENARIO: scenario });
const mockClient = (scenario?: string) => createMetaClient(mock(scenario));

const acct = (name: string, currency = 'COP', id = '1000000000000001') => ({
  id: `act_${id}`,
  account_id: id,
  name,
  account_status: 1,
  currency,
  timezone_name: 'America/Bogota',
});

const CLIENT_ID = '0b6f6f9e-1c1a-4d5e-9a57-2f2f7b1b0a11';
const NAME = `FLV_${CLIENT_ID}`;
const createInput = {
  businessId: '1100000000000001',
  clientId: CLIENT_ID,
  timezoneId: 99,
  endAdvertiser: 'NONE',
  mediaAgency: 'NONE',
  partner: 'NONE',
};

const grantedAll = {
  data: [
    'ads_management',
    'ads_read',
    'business_management',
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_ads',
    'instagram_basic',
  ].map((permission) => ({ permission, status: 'granted' })),
};

describe('against the recorded (mock) responses', () => {
  it('getPages', async () => {
    expect(await getPages(mockClient())).toEqual([
      {
        id: '100000000000001',
        name: 'Peluquería Luna (fixture)',
        tasks: ['ADVERTISE', 'ANALYZE', 'CREATE_CONTENT', 'MANAGE', 'MODERATE'],
        isPublished: true,
      },
    ]);
  });

  it('getInstagramAccount', async () => {
    expect(await getInstagramAccount(mockClient(), '100000000000001')).toEqual({
      id: '17841400000000001',
      username: 'peluqueria_luna_fixture',
    });
  });

  it('checkPagePermissions passes with everything granted', async () => {
    const check = await checkPagePermissions(mockClient(), '100000000000001');
    expect(check).toMatchObject({ ok: true, failures: [], missingPermissions: [] });
    expect(check.grantedPermissions).toContain('ads_management');
  });

  it('checkPagePermissions needs the WhatsApp permission only when asked', async () => {
    const without = () =>
      scriptedFetch([
        json({
          data: [
            'ads_management',
            'ads_read',
            'business_management',
            'pages_show_list',
            'pages_read_engagement',
            'pages_manage_ads',
            'instagram_basic',
          ].map((permission) => ({ permission, status: 'granted' })),
        }),
        json({ data: [{ id: '100000000000001', name: 'P', tasks: ['MANAGE', 'ADVERTISE'] }] }),
      ]);
    const asked = await checkPagePermissions(
      liveClient(without().fetch).client,
      '100000000000001',
      {
        whatsapp: true,
      },
    );
    expect(asked.missingPermissions).toEqual(['whatsapp_business_management']);
    expect(asked.failures.map((f) => f.code)).toEqual(['PERMISSIONS_MISSING']);

    const notAsked = await checkPagePermissions(
      liveClient(without().fetch).client,
      '100000000000001',
    );
    expect(notAsked.ok).toBe(true);
  });

  it('getAdAccount', async () => {
    expect(await getAdAccount(mockClient(), 'act_1000000000000001')).toEqual({
      id: 'act_1000000000000001',
      name: 'FLV_fixture',
      status: 'ACTIVE',
      statusCode: 1,
      disableReason: undefined,
      currency: 'COP',
      timezoneName: 'America/Bogota',
    });
  });

  it('createAdAccount creates when there is none, and returns the new account', async () => {
    const account = await createAdAccount(mockClient(), createInput);
    expect(account).toMatchObject({
      id: 'act_1000000000000001',
      currency: 'COP',
      status: 'ACTIVE',
    });
  });

  it('assignPageToAdAccount', async () => {
    const result = await assignPageToAdAccount(mockClient(), {
      businessId: '1100000000000001',
      pageId: '100000000000001',
      adAccountId: 'act_1000000000000001',
      systemUserId: '1200000000000001',
    });
    expect(result).toEqual({
      status: 'assigned',
      pageId: '100000000000001',
      adAccountId: 'act_1000000000000001',
    });
  });

  it.each([
    ['token-expired', 'auth'],
    ['permission-denied', 'permission'],
    ['rate-limited', 'rate_limited'],
  ])('every function fails with a typed %s error', async (scenario, category) => {
    const client = mockClient(scenario);
    const calls = [
      () => getPages(client),
      () => getInstagramAccount(client, '100000000000001'),
      () => checkPagePermissions(client, '100000000000001'),
      () => getAdAccount(client, 'act_1'),
      () => createAdAccount(client, createInput),
    ];
    for (const call of calls) {
      const err = await call().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(MetaApiError);
      expect(err).toMatchObject({ category });
    }
  });

  it('rate-limited errors carry the wait Meta asked for', async () => {
    const err = (await getPages(mockClient('rate-limited')).catch(
      (e: unknown) => e,
    )) as MetaApiError;
    expect(err.retryAfterMs).toBe(900_000);
  });

  it('page-restricted: reads work', async () => {
    const client = mockClient('page-restricted');
    expect(await getPages(client)).toHaveLength(1);
    expect((await checkPagePermissions(client, '100000000000001')).ok).toBe(true);
  });
});

describe('input validation', () => {
  it('rejects ids that are not numeric before calling Meta', async () => {
    const script = scriptedFetch([]);
    const { client } = liveClient(script.fetch);
    await expect(getInstagramAccount(client, '1/../x')).rejects.toBeInstanceOf(MetaInputError);
    await expect(getAdAccount(client, 'abc')).rejects.toBeInstanceOf(MetaInputError);
    await expect(checkPagePermissions(client, 'x')).rejects.toBeInstanceOf(MetaInputError);
    await expect(
      createAdAccount(client, { ...createInput, businessId: 'x' }),
    ).rejects.toBeInstanceOf(MetaInputError);
    await expect(
      createAdAccount(client, { ...createInput, clientId: 'a b' }),
    ).rejects.toBeInstanceOf(MetaInputError);
    expect(script.calls).toHaveLength(0);
  });
});

describe('getPages and pagination', () => {
  const page = (id: string) => ({ id, name: `Page ${id}`, tasks: ['MANAGE'] });

  it('follows the cursor across pages', async () => {
    const script = scriptedFetch([
      json({
        data: [page('1')],
        paging: { cursors: { after: 'CUR1' }, next: 'https://graph.facebook.com/next' },
      }),
      json({ data: [page('2')] }),
    ]);
    const pages = await getPages(liveClient(script.fetch).client);
    expect(pages.map((p) => p.id)).toEqual(['1', '2']);
    expect(script.calls[0]?.query.get('after')).toBeNull();
    expect(script.calls[1]?.query.get('after')).toBe('CUR1');
    // Only paths we built are ever called.
    expect(script.calls.map((c) => c.path)).toEqual(['/me/accounts', '/me/accounts']);
  });

  it('fails loudly instead of truncating when there are too many pages', async () => {
    const more = () =>
      json({ data: [page('1')], paging: { cursors: { after: 'C' }, next: 'https://x' } });
    const script = scriptedFetch([more(), more()]);
    await expect(getPages(liveClient(script.fetch).client, { maxPages: 2 })).rejects.toBeInstanceOf(
      MetaPaginationLimitError,
    );
  });

  it('rejects a next link without a cursor', async () => {
    const script = scriptedFetch([json({ data: [], paging: { next: 'https://x' } })]);
    await expect(getPages(liveClient(script.fetch).client)).rejects.toBeInstanceOf(MetaSchemaError);
  });

  it('turns an unexpected shape into MetaSchemaError, without retrying or echoing values', async () => {
    const script = scriptedFetch([json({ data: [{ id: 1, name: 'Secret Name' }] })]);
    const err = await getPages(liveClient(script.fetch).client).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MetaSchemaError);
    expect(String(err)).not.toContain('Secret Name');
    expect(script.calls).toHaveLength(1);
  });
});

describe('getInstagramAccount', () => {
  it('returns null when the page has no professional Instagram account', async () => {
    const script = scriptedFetch([json({ id: '100000000000002' })]);
    expect(
      await getInstagramAccount(liveClient(script.fetch).client, '100000000000002'),
    ).toBeNull();
  });
});

describe('checkPagePermissions failures', () => {
  const pagesResponse = (page: object | null) => json({ data: page ? [page] : [] });

  it('reports every failure at once', async () => {
    const script = scriptedFetch([
      json({
        data: [
          { permission: 'ads_management', status: 'granted' },
          { permission: 'pages_manage_ads', status: 'declined' },
        ],
      }),
      pagesResponse({ id: '100000000000001', name: 'P', tasks: ['ANALYZE'], is_published: false }),
    ]);
    const check = await checkPagePermissions(liveClient(script.fetch).client, '100000000000001');
    expect(check.ok).toBe(false);
    expect(check.failures.map((f) => f.code).sort()).toEqual([
      'PAGE_NOT_ADMIN',
      'PAGE_UNPUBLISHED',
      'PERMISSIONS_MISSING',
    ]);
    expect(check.missingPermissions).toContain('pages_manage_ads');
    expect(check.missingPermissions).not.toContain('ads_management');
  });

  it('flags a page the user cannot see as PAGE_NOT_ADMIN', async () => {
    const script = scriptedFetch([json(grantedAll), pagesResponse(null)]);
    const check = await checkPagePermissions(liveClient(script.fetch).client, '100000000000001');
    expect(check.failures).toEqual([
      { code: 'PAGE_NOT_ADMIN', detail: 'The user has no access to this page' },
    ]);
  });

  it('does not flag publication when Meta does not say', async () => {
    const script = scriptedFetch([
      json(grantedAll),
      pagesResponse({ id: '100000000000001', name: 'P', tasks: ['MANAGE', 'ADVERTISE'] }),
    ]);
    expect(
      (await checkPagePermissions(liveClient(script.fetch).client, '100000000000001')).ok,
    ).toBe(true);
  });
});

describe('getAdAccount', () => {
  it('maps unknown status codes to UNKNOWN', async () => {
    const script = scriptedFetch([json({ ...acct('x'), account_status: 999 })]);
    const account = await getAdAccount(liveClient(script.fetch).client, 'act_1000000000000001');
    expect(account).toMatchObject({ status: 'UNKNOWN', statusCode: 999 });
  });
});

describe('createAdAccount (live, scripted)', () => {
  it('reuses an existing FLV_ account instead of creating another', async () => {
    const script = scriptedFetch([json({ data: [acct('Other'), acct(NAME)] })]);
    const account = await createAdAccount(liveClient(script.fetch).client, createInput);
    expect(account).toMatchObject({ id: 'act_1000000000000001', name: NAME });
    expect(script.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /1100000000000001/owned_ad_accounts',
    ]);
  });

  it('refuses an existing account in another currency (it cannot be changed)', async () => {
    const script = scriptedFetch([json({ data: [acct(NAME, 'USD')] })]);
    await expect(
      createAdAccount(liveClient(script.fetch).client, createInput),
    ).rejects.toBeInstanceOf(MetaConflictError);
  });

  it('creates it in COP with the declared fields, then reads it back', async () => {
    const script = scriptedFetch([
      json({ data: [] }),
      json({ id: 'act_1000000000000001' }),
      json(acct(NAME)),
    ]);
    const account = await createAdAccount(liveClient(script.fetch).client, createInput);
    expect(account).toMatchObject({ name: NAME, currency: 'COP' });
    expect(script.calls[1]).toMatchObject({
      method: 'POST',
      path: '/1100000000000001/adaccount',
      body: {
        name: NAME,
        currency: 'COP',
        timezone_id: 99,
        end_advertiser: 'NONE',
        media_agency: 'NONE',
        partner: 'NONE',
      },
    });
    expect(script.calls[2]?.path).toBe('/act_1000000000000001');
  });

  it('after a network failure on the POST it reconciles instead of creating twice', async () => {
    const script = scriptedFetch([
      json({ data: [] }),
      new TypeError('connection reset'),
      json({ data: [acct(NAME)] }),
    ]);
    const account = await createAdAccount(liveClient(script.fetch).client, createInput);
    expect(account.name).toBe(NAME);
    expect(script.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('if reconciliation finds nothing, the network error is surfaced (no blind retry)', async () => {
    const script = scriptedFetch([json({ data: [] }), new TypeError('reset'), json({ data: [] })]);
    await expect(
      createAdAccount(liveClient(script.fetch).client, createInput),
    ).rejects.toBeInstanceOf(MetaNetworkError);
    expect(script.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('a Meta refusal on create is surfaced as is, without a reconciliation lookup', async () => {
    const script = scriptedFetch([json({ data: [] }), graphError(100)]);
    await expect(
      createAdAccount(liveClient(script.fetch).client, createInput),
    ).rejects.toMatchObject({
      category: 'invalid_request',
    });
    expect(script.calls).toHaveLength(2);
  });

  it('does not create an account whose returned currency is not COP', async () => {
    const script = scriptedFetch([
      json({ data: [] }),
      json({ id: 'act_1000000000000001' }),
      json(acct(NAME, 'USD')),
    ]);
    await expect(
      createAdAccount(liveClient(script.fetch).client, createInput),
    ).rejects.toBeInstanceOf(MetaConflictError);
  });
});

describe('sandbox mode', () => {
  const env: MetaEnv = {
    META_MODE: 'sandbox',
    ENVIRONMENT: 'staging',
    META_SYSTEM_USER_TOKEN: 'EAAFAKETOKEN',
    META_SANDBOX_AD_ACCOUNT_ID: '555000111',
  };
  const sandbox = (script: ReturnType<typeof scriptedFetch>) =>
    createMetaClient(env, { fetch: script.fetch });

  it('createAdAccount creates nothing: it returns the sandbox account', async () => {
    const script = scriptedFetch([json(acct('FLV_sandbox', 'COP', '555000111'))]);
    const account = await createAdAccount(sandbox(script), createInput);
    expect(account.id).toBe('act_555000111');
    expect(script.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /act_555000111']);
  });

  it('getAdAccount always reads the sandbox account, whatever id is asked for', async () => {
    const script = scriptedFetch([json(acct('FLV_sandbox', 'COP', '555000111'))]);
    await getAdAccount(sandbox(script), 'act_999');
    expect(script.calls[0]?.path).toBe('/act_555000111');
  });

  it('assignPageToAdAccount never calls Meta (no real pages in sandbox)', async () => {
    const script = scriptedFetch([]);
    const result = await assignPageToAdAccount(sandbox(script), {
      businessId: '1100000000000001',
      pageId: '100000000000001',
      adAccountId: 'act_999',
      systemUserId: '1200000000000001',
    });
    expect(result).toEqual({
      status: 'assigned',
      simulated: true,
      pageId: '100000000000001',
      adAccountId: 'act_555000111',
    });
    expect(script.calls).toHaveLength(0);
  });
});

describe('assignPageToAdAccount (live, scripted)', () => {
  const input = {
    businessId: '1100000000000001',
    pageId: '100000000000001',
    adAccountId: 'act_1000000000000001',
    systemUserId: '1200000000000001',
  };
  const base = { pageId: input.pageId, adAccountId: input.adAccountId };

  it('requests page access, then assigns the system user', async () => {
    const script = scriptedFetch([json({ success: true }), json({ success: true })]);
    const result = await assignPageToAdAccount(liveClient(script.fetch).client, input);
    expect(result).toEqual({ ...base, status: 'assigned' });
    expect(script.calls).toMatchObject([
      {
        method: 'POST',
        path: '/1100000000000001/client_pages',
        body: { page_id: '100000000000001', permitted_tasks: ['ADVERTISE', 'ANALYZE'] },
      },
      {
        method: 'POST',
        path: '/100000000000001/assigned_users',
        body: { user: '1200000000000001', tasks: ['ADVERTISE', 'ANALYZE'] },
      },
    ]);
  });

  it('manual_required when Meta refuses the access request (and does not go on)', async () => {
    const script = scriptedFetch([graphError(200, 403)]);
    const result = await assignPageToAdAccount(liveClient(script.fetch).client, input);
    expect(result).toMatchObject({ ...base, status: 'manual_required' });
    expect(script.calls).toHaveLength(1);
  });

  it('pending_client_approval when only the user assignment is refused', async () => {
    const script = scriptedFetch([json({ success: true }), graphError(200, 403)]);
    const result = await assignPageToAdAccount(liveClient(script.fetch).client, input);
    expect(result).toMatchObject({ ...base, status: 'pending_client_approval' });
  });

  it.each([
    ['a rate limit', () => graphError(80004)],
    ['a token problem', () => graphError(190)],
    ['a transient error', () => graphError(2, 500)],
  ])('does not hide %s as a human task', async (_label, response) => {
    const script = scriptedFetch([response()]);
    await expect(
      assignPageToAdAccount(liveClient(script.fetch).client, input),
    ).rejects.toBeInstanceOf(MetaApiError);
    // Writes are not retried.
    expect(script.calls).toHaveLength(1);
  });
});
