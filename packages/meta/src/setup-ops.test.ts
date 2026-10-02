import { describe, expect, it } from 'vitest';
import {
  MetaApiError,
  MetaInputError,
  createMetaClient,
  getWhatsAppLink,
  probePageRestrictions,
  type MetaEnv,
} from './index';
import { graphError, json, liveClient, scriptedFetch } from './test-utils';

const mockClient = (scenario = 'happy') =>
  createMetaClient({ META_MODE: 'mock', META_MOCK_SCENARIO: scenario } as MetaEnv);

describe('getWhatsAppLink', () => {
  it('linked (mock fixture)', async () => {
    expect(await getWhatsAppLink(mockClient(), '100000000000001')).toEqual({
      status: 'linked',
      number: '+573001112233',
    });
  });

  it('not_linked when the page has no number', async () => {
    const { client } = liveClient(scriptedFetch([json({ id: '1' })]).fetch);
    expect(await getWhatsAppLink(client, '100000000000001')).toEqual({ status: 'not_linked' });
    const empty = liveClient(scriptedFetch([json({ id: '1', whatsapp_number: '' })]).fetch).client;
    expect(await getWhatsAppLink(empty, '100000000000001')).toEqual({ status: 'not_linked' });
  });

  it.each([
    [200, 403, 'permission:200'],
    [100, 400, 'invalid_request:100'],
  ])(
    'unavailable (not "not linked") when Meta refuses with code %i',
    async (code, status, reason) => {
      const { client } = liveClient(scriptedFetch([graphError(code, status)]).fetch);
      expect(await getWhatsAppLink(client, '100000000000001')).toEqual({
        status: 'unavailable',
        reason,
      });
    },
  );

  it('does not hide token, limit or transient problems as "unavailable"', async () => {
    for (const code of [190, 80004]) {
      const { client } = liveClient(scriptedFetch([graphError(code)]).fetch);
      await expect(getWhatsAppLink(client, '100000000000001')).rejects.toBeInstanceOf(MetaApiError);
    }
  });

  it('validates the page id', async () => {
    await expect(getWhatsAppLink(mockClient(), 'x/../y')).rejects.toBeInstanceOf(MetaInputError);
  });
});

describe('probePageRestrictions', () => {
  const input = {
    adAccountId: 'act_1000000000000001',
    pageId: '100000000000001',
    link: 'https://app.fluvia.test',
  };

  it('ok when Meta accepts the validation-only creative (mock)', async () => {
    expect(await probePageRestrictions(mockClient(), input)).toEqual({ status: 'ok' });
  });

  it('restricted on a policy error (mock page-restricted scenario)', async () => {
    expect(await probePageRestrictions(mockClient('page-restricted'), input)).toEqual({
      status: 'restricted',
      code: 368,
    });
  });

  it('asks Meta to VALIDATE only, never to create the creative', async () => {
    const script = scriptedFetch([json({ success: true })]);
    await probePageRestrictions(liveClient(script.fetch).client, input);
    expect(script.calls[0]).toMatchObject({
      method: 'POST',
      path: '/act_1000000000000001/adcreatives',
      body: {
        execution_options: ['validate_only'],
        object_story_spec: { page_id: '100000000000001' },
      },
    });
  });

  it.each([
    [200, 403, 'permission:200'],
    [100, 400, 'invalid_request:100'],
  ])(
    'unverified (never "restricted") on a non-policy refusal, code %i',
    async (code, status, reason) => {
      const { client } = liveClient(scriptedFetch([graphError(code, status)]).fetch);
      expect(await probePageRestrictions(client, input)).toEqual({ status: 'unverified', reason });
    },
  );

  it('lets token, rate-limit and transient errors bubble up for the caller to retry or escalate', async () => {
    for (const code of [190, 80004]) {
      const { client } = liveClient(scriptedFetch([graphError(code)]).fetch);
      await expect(probePageRestrictions(client, input)).rejects.toBeInstanceOf(MetaApiError);
    }
  });

  it('sandbox never calls Meta (no real pages): simulated ok', async () => {
    const script = scriptedFetch([]);
    const client = createMetaClient(
      {
        META_MODE: 'sandbox',
        ENVIRONMENT: 'staging',
        META_SYSTEM_USER_TOKEN: 'EAAFAKETOKEN',
        META_SANDBOX_AD_ACCOUNT_ID: '555',
      },
      { fetch: script.fetch },
    );
    expect(await probePageRestrictions(client, input)).toEqual({ status: 'ok', simulated: true });
    expect(script.calls).toHaveLength(0);
  });

  it('validates its inputs', async () => {
    await expect(
      probePageRestrictions(mockClient(), { ...input, link: 'not a url' }),
    ).rejects.toBeInstanceOf(MetaInputError);
    await expect(
      probePageRestrictions(mockClient(), { ...input, pageId: 'x' }),
    ).rejects.toBeInstanceOf(MetaInputError);
  });
});
