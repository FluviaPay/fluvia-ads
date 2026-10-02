import { expect, it } from 'vitest';
import { appWithDb, fakeDb, testEnv } from '../test-utils';

const up = fakeDb({ execute: async () => [{ '?column?': 1 }] });
const down = fakeDb({
  execute: async () => {
    throw new Error('connection refused: postgres://user:secret@host/db');
  },
});

it('GET /health is ok when the database answers', async () => {
  const res = await appWithDb(up).request('/health', {}, testEnv);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { status: string; version: string; db: { ok: boolean } };
  expect(body).toMatchObject({ status: 'ok', version: '1.2.3', db: { ok: true } });
});

it('GET /health is 503 and does not leak the error when the database fails', async () => {
  const res = await appWithDb(down).request('/health', {}, testEnv);
  expect(res.status).toBe(503);
  const text = await res.text();
  expect(JSON.parse(text)).toMatchObject({ status: 'degraded', db: { ok: false } });
  expect(text).not.toContain('secret');
});

it('GET /health is degraded when DATABASE_URL is missing', async () => {
  const { createApp } = await import('../app');
  const res = await createApp().request('/health', {}, testEnv);
  expect(res.status).toBe(503);
});

it('GET /health reports the environment and the Meta mode (mock by default)', async () => {
  const res = await appWithDb(up).request('/health', {}, testEnv);
  expect(await res.json()).toMatchObject({
    environment: 'development',
    meta: { ok: true, mode: 'mock' },
  });
});

it('GET /health is 503 when META_MODE=live outside production, without leaking secrets', async () => {
  const env = {
    ...testEnv,
    ENVIRONMENT: 'staging',
    META_MODE: 'live',
    META_SYSTEM_USER_TOKEN: 'EAAFAKETOKENFORTESTS1234567890',
  } as typeof testEnv;
  const res = await appWithDb(up).request('/health', {}, env);
  expect(res.status).toBe(503);
  const text = await res.text();
  expect(JSON.parse(text)).toMatchObject({ status: 'degraded', meta: { ok: false, mode: null } });
  expect(text).not.toContain('EAAFAKETOKEN');
});

it('GET /health is ok in production with META_MODE=live and a token', async () => {
  const env = {
    ...testEnv,
    ENVIRONMENT: 'production',
    META_MODE: 'live',
    META_SYSTEM_USER_TOKEN: 'EAAFAKETOKENFORTESTS1234567890',
  } as typeof testEnv;
  const res = await appWithDb(up).request('/health', {}, env);
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ meta: { ok: true, mode: 'live' } });
});
