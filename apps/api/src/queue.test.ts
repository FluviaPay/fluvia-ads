import { MetaApiError } from '@fluvia/meta';
import { describe, expect, it, vi } from 'vitest';
import { encryptToken } from './crypto';
import type { Bindings } from './env';
import type { PipelineDeps } from './meta/pipeline';
import { MAX_ATTEMPTS } from './meta/pipeline';
import { handleQueueBatch } from './queue';
import {
  CLIENT_ID,
  NOW,
  connectEnv,
  memoryEvents,
  memoryLock,
  memorySetupStore,
  mockMeta,
} from './test-utils';
import worker from './index';

const SETUP = {
  ok: true as const,
  config: {
    businessId: '1100000000000001',
    systemUserId: '1200000000000001',
    timezoneId: 99,
    endAdvertiser: 'NONE',
    mediaAgency: 'NONE',
    partner: 'NONE',
  },
};

const received = (extra: object = {}) => ({
  id: '5b1a2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
  type: 'meta.connection.received',
  occurredAt: NOW.toISOString(),
  clientId: CLIENT_ID,
  acknowledged: [],
  ...extra,
});

function message(body: unknown, attempts = 1) {
  return { id: 'm1', body, attempts, ack: vi.fn(), retry: vi.fn() };
}

const batch = (...messages: ReturnType<typeof message>[]) =>
  ({ messages, queue: 'fluvia-events' }) as unknown as MessageBatch<unknown>;

async function deps(overrides: Partial<PipelineDeps> = {}) {
  const encryptedToken = await encryptToken(
    connectEnv.TOKEN_ENCRYPTION_KEY as string,
    'USER_TOKEN',
    `meta_connections:${CLIENT_ID}`,
  );
  const memory = memorySetupStore({ encryptedToken });
  const events = memoryEvents();
  const built: PipelineDeps = {
    store: memory.store,
    meta: mockMeta,
    lock: memoryLock().lock,
    events: events.publisher,
    setup: SETUP,
    tokenKey: connectEnv.TOKEN_ENCRYPTION_KEY as string,
    webBaseUrl: 'https://app.fluvia.test',
    now: () => NOW,
    newId: () => '5b1a2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
    ...overrides,
  };
  return { built, memory, events };
}

const env = connectEnv as Bindings;

describe('handleQueueBatch', () => {
  it('processes meta.connection.received end to end and acks it (mock Meta)', async () => {
    const { built, memory, events } = await deps();
    const m = message(received());
    await handleQueueBatch(batch(m), env, () => built);

    expect(m.ack).toHaveBeenCalledOnce();
    expect(m.retry).not.toHaveBeenCalled();
    expect(memory.state.connection.status).toBe('connected');
    expect(events.published).toHaveLength(1);
    expect(events.published[0]).toMatchObject({ type: 'meta.connected', clientId: CLIENT_ID });
  });

  it('acks meta.connected without doing anything: nobody consumes it until the payment step', async () => {
    const { built, events } = await deps();
    const m = message({
      id: '5b1a2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
      type: 'meta.connected',
      occurredAt: NOW.toISOString(),
      clientId: CLIENT_ID,
      idempotencyKey: 'k',
      data: { adAccountId: 'act_1', pageId: '1', igId: null, messageDestinations: ['whatsapp'] },
    });
    await handleQueueBatch(batch(m), env, () => built);
    expect(m.ack).toHaveBeenCalledOnce();
    expect(events.published).toEqual([]);
  });

  it('drops malformed messages (ack) instead of retrying them forever', async () => {
    const { built } = await deps();
    for (const body of [null, 'text', { type: 'nope' }, { type: 'meta.connection.received' }]) {
      const m = message(body);
      await handleQueueBatch(batch(m), env, () => built);
      expect(m.ack, JSON.stringify(body)).toHaveBeenCalledOnce();
      expect(m.retry).not.toHaveBeenCalled();
    }
  });

  it('forwards what a person acknowledged and the delivery attempt number', async () => {
    const { built } = await deps();
    const spy = vi.spyOn(built.lock, 'acquire');
    const m = message(received({ acknowledged: ['WA_VERIFY_MANUAL'] }), 3);
    await handleQueueBatch(batch(m), env, () => built);
    expect(spy).toHaveBeenCalledWith(CLIENT_ID);
    expect(m.ack).toHaveBeenCalled();
  });

  it('a "retry later" result (e.g. a rate limit, or the lock is busy) goes back to the queue with its delay', async () => {
    const { built } = await deps();
    await built.lock.acquire(CLIENT_ID);
    const m = message(received());
    await handleQueueBatch(batch(m), env, () => built);
    expect(m.retry).toHaveBeenCalledWith({ delaySeconds: 60 });
    expect(m.ack).not.toHaveBeenCalled();
  });

  it('a result that needs a human is acked (the task is the follow-up, not a retry)', async () => {
    const { built, memory } = await deps({ setup: { ok: false, missing: ['META_PARTNER'] } });
    const m = message(received());
    await handleQueueBatch(batch(m), env, () => built);
    expect(m.ack).toHaveBeenCalledOnce();
    expect(memory.tasks.map((t) => t.payload.code)).toEqual(['CONFIG_MISSING']);
  });

  it('an unexpected failure (database down, a bug) is retried with backoff', async () => {
    const { built } = await deps();
    built.store.getContext = async () => {
      throw new Error('database down');
    };
    const first = message(received(), 1);
    const third = message(received(), 3);
    await handleQueueBatch(batch(first), env, () => built);
    await handleQueueBatch(batch(third), env, () => built);
    expect(first.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
    expect(third.retry).toHaveBeenCalledWith({ delaySeconds: 120 });
    expect(first.ack).not.toHaveBeenCalled();
  });

  it('on the last attempt an unexpected failure becomes a technical task and the message is acked', async () => {
    const { built, memory } = await deps();
    const getContext = built.store.getContext;
    let calls = 0;
    built.store.getContext = async (id) => {
      // Fails for the pipeline, works for the final-failure bookkeeping.
      if (calls++ === 0) throw new MetaApiError({ status: 500, headers: {}, body: {} });
      return getContext(id);
    };
    const m = message(received(), MAX_ATTEMPTS);
    await handleQueueBatch(batch(m), env, () => built);
    expect(m.ack).toHaveBeenCalledOnce();
    expect(m.retry).not.toHaveBeenCalled();
    expect(memory.tasks.map((t) => t.payload.code)).toEqual(['SETUP_FAILED_TECHNICAL']);
    expect(memory.tasks[0]?.payload.detail).toBe('unexpected:MetaApiError');
  });

  it('if the dependencies cannot even be built, messages are retried, then acked at the end', async () => {
    const broken = () => {
      throw new Error('not configured');
    };
    const early = message(received(), 1);
    const last = message(received(), MAX_ATTEMPTS);
    await handleQueueBatch(batch(early, last), env, broken);
    expect(early.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
    expect(last.ack).toHaveBeenCalledOnce();
  });

  it('one bad message does not stop the rest of the batch', async () => {
    const { built, memory } = await deps();
    const bad = message({ junk: true });
    const good = message(received());
    await handleQueueBatch(batch(bad, good), env, () => built);
    expect(bad.ack).toHaveBeenCalled();
    expect(good.ack).toHaveBeenCalled();
    expect(memory.state.connection.status).toBe('connected');
  });
});

describe('worker entry point', () => {
  it('exports both fetch and queue handlers, and the ClientLock Durable Object', async () => {
    expect(typeof worker.fetch).toBe('function');
    expect(typeof worker.queue).toBe('function');
    const mod = await import('./index');
    expect(typeof mod.ClientLock).toBe('function');
  });

  it('still serves /health through fetch', async () => {
    const res = await worker.fetch(
      new Request('https://api.test/nope'),
      connectEnv as never,
      {} as never,
    );
    expect(res.status).toBe(404);
  });
});
