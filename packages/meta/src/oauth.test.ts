import { describe, expect, it } from 'vitest';
import {
  MetaApiError,
  buildLoginUrl,
  createMetaClient,
  exchangeCodeForToken,
  getGrantedPermissions,
} from './index';
import { graphError, json, liveClient, scriptedFetch } from './test-utils';

const exchangeInput = {
  appId: '123',
  appSecret: 'APP_SECRET_FOR_TESTS',
  redirectUri: 'https://api.example.com/meta/callback',
  code: 'THE_CODE',
};

describe('buildLoginUrl', () => {
  it('builds the dialog URL for the pinned version with every parameter encoded', () => {
    const url = new URL(
      buildLoginUrl({
        appId: '123',
        configId: '456',
        redirectUri: 'https://api.example.com/meta/callback?x=1',
        state: 'a.b',
      }),
    );
    expect(`${url.origin}${url.pathname}`).toBe('https://www.facebook.com/v26.0/dialog/oauth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: '123',
      redirect_uri: 'https://api.example.com/meta/callback?x=1',
      state: 'a.b',
      config_id: '456',
      response_type: 'code',
      override_default_response_type: 'true',
    });
  });
});

describe('exchangeCodeForToken', () => {
  it('returns a fake token in mock mode, without any network', async () => {
    const client = createMetaClient({ META_MODE: 'mock' });
    expect(await exchangeCodeForToken(client, exchangeInput)).toEqual({
      accessToken: 'MOCK_USER_TOKEN_not_a_real_token',
      tokenType: 'bearer',
      expiresInSec: 5184000,
    });
  });

  it('uses the app credentials and sends no Authorization header (live)', async () => {
    const script = scriptedFetch([json({ access_token: 'USER_TOKEN', expires_in: 3600 })]);
    const { client } = liveClient(script.fetch);
    const token = await exchangeCodeForToken(client, exchangeInput);
    expect(token).toEqual({ accessToken: 'USER_TOKEN', tokenType: undefined, expiresInSec: 3600 });

    const call = script.calls[0];
    expect(call?.path).toBe('/oauth/access_token');
    expect(Object.fromEntries(call?.query ?? [])).toEqual({
      client_id: '123',
      client_secret: 'APP_SECRET_FOR_TESTS',
      redirect_uri: 'https://api.example.com/meta/callback',
      code: 'THE_CODE',
    });
    expect(call?.headers.authorization).toBeUndefined();
  });

  it('surfaces a Meta refusal as MetaApiError (no retry on a bad code)', async () => {
    const script = scriptedFetch([graphError(100)]);
    const { client } = liveClient(script.fetch);
    await expect(exchangeCodeForToken(client, exchangeInput)).rejects.toBeInstanceOf(MetaApiError);
    expect(script.calls).toHaveLength(1);
  });

  it('rejects a response without a token', async () => {
    const { client } = liveClient(scriptedFetch([json({ token_type: 'bearer' })]).fetch);
    await expect(exchangeCodeForToken(client, exchangeInput)).rejects.toMatchObject({
      name: 'MetaSchemaError',
    });
  });
});

describe('client token override', () => {
  it("calls Meta with the given user token instead of the system user's", async () => {
    const script = scriptedFetch([json({ data: [] })]);
    const { client } = liveClient(script.fetch, { token: 'CLIENT_USER_TOKEN' });
    await client.get('/me/accounts');
    expect(script.calls[0]?.headers.authorization).toBe('Bearer CLIENT_USER_TOKEN');
  });

  it('uses the system user token by default', async () => {
    const script = scriptedFetch([json({ data: [] })]);
    const { client } = liveClient(script.fetch);
    await client.get('/me/accounts');
    expect(script.calls[0]?.headers.authorization).toBe('Bearer EAAFAKETOKEN');
  });
});

describe('getGrantedPermissions', () => {
  it('lists only the granted permissions', async () => {
    const script = scriptedFetch([
      json({
        data: [
          { permission: 'ads_management', status: 'granted' },
          { permission: 'pages_manage_ads', status: 'declined' },
        ],
      }),
    ]);
    expect(await getGrantedPermissions(liveClient(script.fetch).client)).toEqual([
      'ads_management',
    ]);
  });
});
