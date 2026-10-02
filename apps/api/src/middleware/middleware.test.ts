import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { expect, it } from 'vitest';
import { createApp } from '../app';
import type { AppEnv } from '../env';
import { parseBody, parseQuery } from '../validate';
import { onError, notFound } from './errors';
import { requestId } from './request-id';
import { testEnv } from '../test-utils';

function testApp() {
  const app = new Hono<AppEnv>();
  app.use(requestId);
  app.post('/echo', async (c) => c.json(await parseBody(c, z.object({ name: z.string().min(1) }))));
  app.get('/search', async (c) => c.json(await parseQuery(c, z.object({ q: z.string() }))));
  app.get('/boom', () => {
    throw new Error('db password is hunter2');
  });
  app.get('/forbidden', () => {
    throw new HTTPException(403, { message: 'No' });
  });
  app.onError(onError);
  app.notFound(notFound);
  return app;
}

it('generates a request id and echoes a valid incoming one', async () => {
  const app = createApp();
  const generated = await app.request('/nope', {}, testEnv);
  expect(generated.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);

  const echoed = await app.request('/nope', { headers: { 'x-request-id': 'abc-123' } }, testEnv);
  expect(echoed.headers.get('x-request-id')).toBe('abc-123');

  const bad = await app.request('/nope', { headers: { 'x-request-id': 'bad id!' } }, testEnv);
  expect(bad.headers.get('x-request-id')).not.toBe('bad id!');
});

it('returns JSON 404 with the request id', async () => {
  const res = await createApp().request('/nope', { headers: { 'x-request-id': 'r1' } }, testEnv);
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({
    error: { code: 'not_found', message: 'Route not found', request_id: 'r1' },
  });
});

it('returns a generic JSON 500 without leaking the error', async () => {
  const res = await testApp().request('/boom');
  expect(res.status).toBe(500);
  const text = await res.text();
  expect(JSON.parse(text).error).toMatchObject({ code: 'internal_error' });
  expect(text).not.toContain('hunter2');
});

it('keeps the status of HTTPException as JSON', async () => {
  const res = await testApp().request('/forbidden');
  expect(res.status).toBe(403);
  expect((await res.json()) as object).toMatchObject({
    error: { code: 'forbidden', message: 'No' },
  });
});

it('validates bodies with Zod: 400 with issues, 400 on invalid JSON, 200 when valid', async () => {
  const app = testApp();
  const post = (body: string) =>
    app.request('/echo', { method: 'POST', body, headers: { 'content-type': 'application/json' } });

  const invalid = await post('{"name":""}');
  expect(invalid.status).toBe(400);
  const json = (await invalid.json()) as { error: { code: string; issues: unknown[] } };
  expect(json.error.code).toBe('validation_error');
  expect(json.error.issues.length).toBeGreaterThan(0);

  expect((await post('{not json')).status).toBe(400);

  const ok = await post('{"name":"Ana"}');
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({ name: 'Ana' });
});

it('validates query strings with Zod', async () => {
  const app = testApp();
  expect((await app.request('/search')).status).toBe(400);
  expect(await (await app.request('/search?q=hola')).json()).toEqual({ q: 'hola' });
});
