import { describe, expect, it, vi } from 'vitest';
import { MetaSandboxViolation, createMetaClient, withSandbox } from './index';
import type { MetaRequest, MetaTransport } from './index';

const SANDBOX_ID = '555000111';

function recorder() {
  const calls: MetaRequest[] = [];
  const transport: MetaTransport = async (req) => {
    calls.push(req);
    return { status: 200, headers: {}, body: { ok: true } };
  };
  return { calls, transport };
}

describe('withSandbox', () => {
  it('replaces any ad account id in the path with the sandbox one', async () => {
    const { calls, transport } = recorder();
    await withSandbox(
      transport,
      SANDBOX_ID,
    )({ method: 'POST', path: '/act_999/campaigns', body: {} });
    expect(calls[0]?.path).toBe(`/act_${SANDBOX_ID}/campaigns`);
  });

  it('leaves non-campaign paths alone', async () => {
    const { calls, transport } = recorder();
    await withSandbox(transport, SANDBOX_ID)({ method: 'GET', path: '/me/accounts' });
    expect(calls[0]?.path).toBe('/me/accounts');
  });

  it('rejects another ad account in the query or the body, without calling Meta', () => {
    const { calls, transport } = recorder();
    const sandboxed = withSandbox(transport, SANDBOX_ID);
    expect(() =>
      sandboxed({ method: 'GET', path: '/me/adaccounts', query: { account: 'act_777' } }),
    ).toThrow(MetaSandboxViolation);
    expect(() =>
      sandboxed({ method: 'POST', path: '/123/ads', body: { ad_account: 'act_777' } }),
    ).toThrow(/act_777/);
    expect(calls).toHaveLength(0);
  });

  it('allows the sandbox account itself in the body', async () => {
    const { calls, transport } = recorder();
    await withSandbox(
      transport,
      SANDBOX_ID,
    )({
      method: 'POST',
      path: '/123/ads',
      body: { ad_account: `act_${SANDBOX_ID}` },
    });
    expect(calls).toHaveLength(1);
  });

  it.each(['/1100/adaccount', '/1100/adaccounts', '/1100/owned_ad_accounts'])(
    'blocks creating ad accounts via POST %s',
    (path) => {
      const { calls, transport } = recorder();
      expect(() => withSandbox(transport, SANDBOX_ID)({ method: 'POST', path })).toThrow(
        /disabled in sandbox/,
      );
      expect(calls).toHaveLength(0);
    },
  );
});

describe('sandbox client', () => {
  const env = {
    META_MODE: 'sandbox',
    ENVIRONMENT: 'staging',
    META_SYSTEM_USER_TOKEN: 'EAAFAKETOKEN',
    META_SANDBOX_AD_ACCOUNT_ID: `act_${SANDBOX_ID}`,
  };

  it('always resolves the sandbox ad account, whatever is requested', () => {
    const client = createMetaClient(env, { fetch: vi.fn<typeof fetch>() });
    expect(client.resolveAdAccountId('act_999')).toBe(`act_${SANDBOX_ID}`);
    expect(client.resolveAdAccountId()).toBe(`act_${SANDBOX_ID}`);
  });

  it('sends campaign calls to the sandbox account over HTTP', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => Response.json({ id: '1' }));
    const client = createMetaClient(env, { fetch: fetchFn });
    await client.post('/act_999/campaigns', { name: 'x' });
    expect(String(fetchFn.mock.calls[0]?.[0])).toBe(
      `https://graph.facebook.com/v26.0/act_${SANDBOX_ID}/campaigns`,
    );
  });
});
