import { describe, expect, it, vi } from 'vitest';
import { MOCK_AD_ACCOUNT_ID, MetaApiError, createMetaClient, type MetaEnv } from './index';

const mock = (scenario?: string): MetaEnv => ({
  META_MODE: 'mock',
  ...(scenario ? { META_MOCK_SCENARIO: scenario } : {}),
});

async function failure(env: MetaEnv, path = '/act_1/campaigns') {
  try {
    await createMetaClient(env).post(path, {});
  } catch (err) {
    return err as MetaApiError;
  }
  throw new Error('expected the call to fail');
}

describe('mock mode', () => {
  it('serves recorded happy responses without touching the network', async () => {
    const networkSpy = vi.spyOn(globalThis, 'fetch');
    const client = createMetaClient(mock());
    const perms = await client.get('/me/permissions');
    expect(perms.status).toBe(200);
    expect(JSON.stringify(perms.body)).toContain('ads_management');

    const campaign = await client.post('/act_42/campaigns', { name: 'x' });
    expect(campaign.body).toEqual({ id: '120200000000001' });
    expect(networkSpy).not.toHaveBeenCalled();
    networkSpy.mockRestore();
  });

  it('answers 400/code 100 for something that has no fixture', async () => {
    const err = await failure(mock(), '/not/recorded');
    expect(err).toBeInstanceOf(MetaApiError);
    expect(err).toMatchObject({ code: 100, category: 'invalid_request' });
  });

  it('resolves the requested ad account, or the mock one', () => {
    const client = createMetaClient(mock());
    expect(client.resolveAdAccountId('777')).toBe('act_777');
    expect(client.resolveAdAccountId('act_777')).toBe('act_777');
    expect(client.resolveAdAccountId()).toBe(MOCK_AD_ACCOUNT_ID);
  });

  it('rejects unsafe paths', async () => {
    const client = createMetaClient(mock());
    await expect(client.get('/me/../admin')).rejects.toThrow(/Invalid Meta path/);
    await expect(client.get('me/accounts')).rejects.toThrow(/Invalid Meta path/);
    await expect(client.get('/me?access_token=x')).rejects.toThrow(/Invalid Meta path/);
  });
});

describe('error scenarios', () => {
  it('permission-denied -> permission', async () => {
    const err = await failure(mock('permission-denied'));
    expect(err).toMatchObject({ status: 403, code: 200, category: 'permission' });
    expect(err.fbtraceId).toBe('FIXTURE_PERMISSION_0001');
  });

  it('token-expired -> auth, for any endpoint', async () => {
    for (const path of ['/me/permissions', '/me/accounts', '/act_1/campaigns']) {
      const err = await failure(mock('token-expired'), path);
      expect(err).toMatchObject({ code: 190, subcode: 463, category: 'auth' });
    }
  });

  it('rate-limited -> rate_limited and exposes the usage headers', async () => {
    const err = await failure(mock('rate-limited'));
    expect(err).toMatchObject({ code: 80004, category: 'rate_limited' });
    const usage = JSON.parse(err.headers['x-business-use-case-usage'] ?? '{}') as Record<
      string,
      { estimated_time_to_regain_access: number }[]
    >;
    expect(Object.values(usage)[0]?.[0]?.estimated_time_to_regain_access).toBe(15);
    expect(err.headers['x-app-usage']).toBeDefined();
    expect(err.headers['x-ad-account-usage']).toBeDefined();
  });

  it('page-restricted -> reads work, creating the creative is blocked by policy', async () => {
    const client = createMetaClient(mock('page-restricted'));
    expect((await client.get('/me/accounts')).status).toBe(200);
    expect((await client.get('/100000000000001')).status).toBe(200);
    const err = await failure(mock('page-restricted'), '/act_1/adcreatives');
    expect(err).toMatchObject({ code: 368, category: 'policy' });
  });
});

describe('live mode', () => {
  it('is refused outside production, even with a token', () => {
    expect(() =>
      createMetaClient({
        META_MODE: 'live',
        ENVIRONMENT: 'staging',
        META_SYSTEM_USER_TOKEN: 'EAAFAKETOKEN',
      }),
    ).toThrow(/only allowed when ENVIRONMENT=production/);
  });

  it('calls the pinned version with the token in a header, not in the URL', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => Response.json({ data: [] }));
    const client = createMetaClient(
      { META_MODE: 'live', ENVIRONMENT: 'production', META_SYSTEM_USER_TOKEN: 'EAAFAKETOKEN' },
      { fetch: fetchFn },
    );
    await client.get('/me/accounts', { fields: 'id,name' });

    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://graph.facebook.com/v26.0/me/accounts?fields=id%2Cname');
    expect(String(url)).not.toContain('EAAFAKETOKEN');
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer EAAFAKETOKEN');
  });

  it('turns non-2xx responses into MetaApiError (also without a Graph error body)', async () => {
    const fetchFn = vi.fn(async () => new Response('Bad gateway', { status: 502 }));
    const client = createMetaClient(
      { META_MODE: 'live', ENVIRONMENT: 'production', META_SYSTEM_USER_TOKEN: 'EAAFAKETOKEN' },
      { fetch: fetchFn },
    );
    await expect(client.get('/me/accounts')).rejects.toMatchObject({
      name: 'MetaApiError',
      category: 'transient',
      status: 502,
    });
  });
});
