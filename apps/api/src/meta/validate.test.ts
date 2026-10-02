import { createMetaClient } from '@fluvia/meta';
import { describe, expect, it } from 'vitest';
import { jsonResponse, metaFromFetch, routedFetch } from '../test-utils';
import { validateConnection } from './validate';

const PAGE = '100000000000001';
const allPermissions = [
  'ads_management',
  'ads_read',
  'business_management',
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_ads',
  'instagram_basic',
  'whatsapp_business_management',
].map((permission) => ({ permission, status: 'granted' }));

const goodPage = { id: PAGE, name: 'P', tasks: ['MANAGE', 'ADVERTISE'], is_published: true };

function routes(overrides: Record<string, () => Response | Error> = {}) {
  return {
    'GET /me/permissions': () => jsonResponse({ data: allPermissions }),
    'GET /me/accounts': () => jsonResponse({ data: [goodPage] }),
    [`GET /${PAGE}`]: () =>
      jsonResponse({
        id: PAGE,
        instagram_business_account: { id: '17841400000000001' },
        whatsapp_number: '+573001112233',
      }),
    ...overrides,
  };
}

const run = (destinations: ('whatsapp' | 'instagram_direct' | 'messenger')[], over = {}) =>
  validateConnection(metaFromFetch(routedFetch(routes(over)).fetch)('USER'), {
    pageId: PAGE,
    destinations,
  });

describe('validateConnection', () => {
  it('passes with the mock fixtures (all good)', async () => {
    const client = createMetaClient({ META_MODE: 'mock' });
    expect(
      await validateConnection(client, {
        pageId: PAGE,
        destinations: ['whatsapp', 'instagram_direct'],
      }),
    ).toEqual({ failures: [], igId: '17841400000000001' });
  });

  it('passes when everything is in place', async () => {
    expect(await run(['whatsapp', 'instagram_direct'])).toEqual({
      failures: [],
      igId: '17841400000000001',
    });
  });

  it('flags a user who is not an administrator, and an unpublished page', async () => {
    const result = await run(['messenger'], {
      'GET /me/accounts': () =>
        jsonResponse({ data: [{ ...goodPage, tasks: ['ANALYZE'], is_published: false }] }),
    });
    expect(result.failures.map((f) => f.code).sort()).toEqual([
      'PAGE_NOT_ADMIN',
      'PAGE_UNPUBLISHED',
    ]);
  });

  it('flags missing permissions', async () => {
    const result = await run(['messenger'], {
      'GET /me/permissions': () =>
        jsonResponse({ data: [{ permission: 'ads_read', status: 'granted' }] }),
    });
    expect(result.failures.map((f) => f.code)).toContain('PERMISSIONS_MISSING');
  });

  describe('Instagram', () => {
    const noInstagram = {
      [`GET /${PAGE}`]: () => jsonResponse({ id: PAGE, whatsapp_number: '+57' }),
    };

    it('is required only when Instagram Direct is a destination', async () => {
      expect((await run(['instagram_direct'], noInstagram)).failures).toEqual([
        { code: 'IG_NOT_PROFESSIONAL' },
      ]);
      expect((await run(['whatsapp'], noInstagram)).failures).toEqual([]);
      expect((await run(['messenger'], noInstagram)).igId).toBeNull();
    });
  });

  describe('WhatsApp', () => {
    const page = (extra: object) => ({
      [`GET /${PAGE}`]: () =>
        jsonResponse({ id: PAGE, instagram_business_account: { id: '1' }, ...extra }),
    });

    it('is required only when WhatsApp is a destination', async () => {
      expect((await run(['instagram_direct'], page({}))).failures).toEqual([]);
    });

    it('WA_NOT_LINKED when the page has no number', async () => {
      expect((await run(['whatsapp'], page({}))).failures).toEqual([{ code: 'WA_NOT_LINKED' }]);
    });

    it('WA_VERIFY_MANUAL when Meta will not let us read it (never a guess)', async () => {
      const refused = {
        [`GET /${PAGE}`]: ({ query }: { query: URLSearchParams }) =>
          query.get('fields') === 'whatsapp_number'
            ? jsonResponse({ error: { message: 'm', code: 100 } }, 400)
            : jsonResponse({ id: PAGE, instagram_business_account: { id: '1' } }),
      };
      const result = await run(['whatsapp'], refused);
      expect(result.failures).toEqual([
        { code: 'WA_VERIFY_MANUAL', detail: 'invalid_request:100' },
      ]);
    });
  });

  it('asks for the WhatsApp permission only when WhatsApp is a destination', async () => {
    const without = {
      'GET /me/permissions': () =>
        jsonResponse({
          data: allPermissions.filter((p) => p.permission !== 'whatsapp_business_management'),
        }),
    };
    expect((await run(['whatsapp'], without)).failures.map((f) => f.code)).toContain(
      'PERMISSIONS_MISSING',
    );
    expect((await run(['instagram_direct'], without)).failures).toEqual([]);
  });

  it('collects every problem at once', async () => {
    const result = await run(['whatsapp', 'instagram_direct'], {
      'GET /me/accounts': () => jsonResponse({ data: [{ ...goodPage, tasks: [] }] }),
      [`GET /${PAGE}`]: () => jsonResponse({ id: PAGE }),
    });
    expect(result.failures.map((f) => f.code).sort()).toEqual([
      'IG_NOT_PROFESSIONAL',
      'PAGE_NOT_ADMIN',
      'WA_NOT_LINKED',
    ]);
  });
});
