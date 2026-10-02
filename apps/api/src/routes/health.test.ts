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
