import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDoLock } from '../meta/lock';
import { ClientLock } from './client-lock';

/** Minimal in-memory DurableObjectState: get/put/delete is all the lock uses. */
function fakeState() {
  const data = new Map<string, unknown>();
  return {
    storage: {
      get: async (key: string) => data.get(key),
      put: async (key: string, value: unknown) => void data.set(key, value),
      delete: async (key: string) => data.delete(key),
    },
  } as unknown as DurableObjectState;
}

const post = (lock: ClientLock, path: string, body: unknown, method = 'POST') =>
  lock.fetch(
    new Request(`https://client-lock${path}`, {
      method,
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
    }),
  );

describe('ClientLock', () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date('2026-10-02T12:00:00Z') }));
  afterEach(() => vi.useRealTimers());

  it('grants the lock once and refuses a second holder', async () => {
    const lock = new ClientLock(fakeState());
    const first = await post(lock, '/acquire', { ttlSeconds: 60 });
    expect(first.status).toBe(200);
    expect(((await first.json()) as { lease: string }).lease).toMatch(/^[0-9a-f-]{36}$/);
    expect((await post(lock, '/acquire', { ttlSeconds: 60 })).status).toBe(409);
  });

  it('lets a new holder in once the lease expired (a crashed run cannot block forever)', async () => {
    const lock = new ClientLock(fakeState());
    await post(lock, '/acquire', { ttlSeconds: 60 });
    vi.advanceTimersByTime(59_000);
    expect((await post(lock, '/acquire', {})).status).toBe(409);
    vi.advanceTimersByTime(2_000);
    expect((await post(lock, '/acquire', {})).status).toBe(200);
  });

  it('only the holder can release', async () => {
    const lock = new ClientLock(fakeState());
    const { lease } = (await (await post(lock, '/acquire', { ttlSeconds: 60 })).json()) as {
      lease: string;
    };
    await post(lock, '/release', { lease: 'someone-else' });
    expect((await post(lock, '/acquire', {})).status).toBe(409);
    await post(lock, '/release', { lease });
    expect((await post(lock, '/acquire', {})).status).toBe(200);
  });

  it('a stale holder cannot free the lease of the new one', async () => {
    const lock = new ClientLock(fakeState());
    const old = (await (await post(lock, '/acquire', { ttlSeconds: 1 })).json()) as {
      lease: string;
    };
    vi.advanceTimersByTime(2_000);
    const fresh = (await (await post(lock, '/acquire', { ttlSeconds: 60 })).json()) as {
      lease: string;
    };
    await post(lock, '/release', { lease: old.lease });
    expect((await post(lock, '/acquire', {})).status).toBe(409);
    await post(lock, '/release', { lease: fresh.lease });
    expect((await post(lock, '/acquire', {})).status).toBe(200);
  });

  it('caps the ttl and rejects other methods and paths', async () => {
    const lock = new ClientLock(fakeState());
    await post(lock, '/acquire', { ttlSeconds: 999_999 });
    vi.advanceTimersByTime(901_000);
    expect((await post(lock, '/acquire', {})).status).toBe(200);
    expect((await post(lock, '/acquire', {}, 'GET')).status).toBe(405);
    expect((await post(lock, '/other', {})).status).toBe(404);
  });
});

describe('createDoLock (the port the pipeline uses)', () => {
  function namespace() {
    const objects = new Map<string, ClientLock>();
    return {
      idFromName: (name: string) => name,
      get: (id: string) => {
        if (!objects.has(id)) objects.set(id, new ClientLock(fakeState()));
        const object = objects.get(id) as ClientLock;
        return { fetch: (url: string, init: RequestInit) => object.fetch(new Request(url, init)) };
      },
    } as unknown as DurableObjectNamespace;
  }

  it('acquire / release round trip, one lock per client', async () => {
    const lock = createDoLock(namespace());
    const a = await lock.acquire('client-a');
    expect(a).toBeTruthy();
    expect(await lock.acquire('client-a')).toBeNull();
    expect(await lock.acquire('client-b')).toBeTruthy();
    await lock.release('client-a', a ?? '');
    expect(await lock.acquire('client-a')).toBeTruthy();
  });
});
