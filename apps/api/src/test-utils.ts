import type { Db } from '@fluvia/db';
import { createMetaClient } from '@fluvia/meta';
import { vi } from 'vitest';
import { createApp } from './app';
import type { Bindings } from './env';
import type { ConnectionOutcome, ConnectionStore } from './meta/store';

export const testEnv = { APP_VERSION: '1.2.3', ENVIRONMENT: 'development' } as Bindings;

export const fakeDb = (impl: Partial<Record<'execute' | 'insert', unknown>> = {}) =>
  impl as unknown as Db;

export const appWithDb = (db: Db) => createApp({ getDb: () => db });

// ---- Meta connection flow helpers -------------------------------------------------

export const CLIENT_ID = '0b6f6f9e-1c1a-4d5e-9a57-2f2f7b1b0a11';
export const NOW = new Date('2026-10-02T12:00:00.000Z');

export const connectEnv = {
  APP_VERSION: '1.2.3',
  ENVIRONMENT: 'development',
  META_MODE: 'mock',
  TOKEN_ENCRYPTION_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),
  OAUTH_STATE_SECRET: 's'.repeat(40),
  INTERNAL_API_TOKEN: 'internal-token-'.repeat(3),
  WEB_BASE_URL: 'https://app.fluvia.test',
  API_BASE_URL: 'https://api.fluvia.test',
} as unknown as Bindings;

/** In-memory store with the same single-use / expiry semantics as the SQL. */
export function memoryStore(clients: string[] = [CLIENT_ID]) {
  const nonces = new Map<string, { nonce: string; expiresAt: Date }>();
  const outcomes: ConnectionOutcome[] = [];
  const enqueueFailures: { clientId: string; task: { type: string } }[] = [];
  const store: ConnectionStore = {
    async clientExists(id) {
      return clients.includes(id);
    },
    async createLink({ clientId, nonce, expiresAt }) {
      nonces.set(clientId, { nonce, expiresAt });
    },
    async consumeNonce({ clientId, nonce, now }) {
      const current = nonces.get(clientId);
      if (!current || current.nonce !== nonce || current.expiresAt <= now) return false;
      nonces.delete(clientId);
      return true;
    },
    async recordOutcome(outcome) {
      outcomes.push(outcome);
      if ('retry' in outcome && outcome.retry) nonces.set(outcome.clientId, outcome.retry);
    },
    async recordEnqueueFailure(input) {
      enqueueFailures.push(input);
    },
  };
  return { store, nonces, outcomes, enqueueFailures };
}

type Route = (call: { query: URLSearchParams }) => Response | Error;

/** A fetch that answers by "METHOD /path" (order-independent) and records the calls. */
export function routedFetch(routes: Record<string, Route>) {
  const calls: { key: string; headers: Record<string, string> }[] = [];
  const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    const key = `${init?.method ?? 'GET'} ${url.pathname.replace(/^\/v[\d.]+/, '')}`;
    calls.push({ key, headers: (init?.headers ?? {}) as Record<string, string> });
    const route = routes[key];
    if (!route) throw new Error(`Unexpected call: ${key}`);
    const result = route({ query: url.searchParams });
    if (result instanceof Error) throw result;
    return result;
  });
  return { fetch: fetchFn, calls };
}

export const jsonResponse = (body: unknown, status = 200) => Response.json(body, { status });

export const metaFromFetch = (fetchFn: typeof fetch) => (token?: string) =>
  createMetaClient(
    { META_MODE: 'live', ENVIRONMENT: 'production', META_SYSTEM_USER_TOKEN: 'EAASYSTEMTOKEN' },
    { fetch: fetchFn, sleep: async () => {}, random: () => 1, ...(token ? { token } : {}) },
  );

export const mockMeta = (token?: string) =>
  createMetaClient({ META_MODE: 'mock' }, token ? { token } : {});

// ---- Setup pipeline helpers --------------------------------------------------------

import type { AuditEntry } from './audit';
import type { EventPublisher } from './events';
import type { ClientLockPort } from './meta/lock';
import type { SetupContext, SetupStore } from './meta/setup-store';

export function memoryEvents() {
  const published: Parameters<EventPublisher['publish']>[0][] = [];
  const state = { failNext: false };
  const publisher: EventPublisher = {
    async publish(event) {
      if (state.failNext) {
        state.failNext = false;
        throw new Error('queue unavailable');
      }
      published.push(event);
    },
  };
  return { publisher, published, state };
}

export function memoryLock() {
  const held = new Map<string, string>();
  let counter = 0;
  const lock: ClientLockPort = {
    async acquire(clientId) {
      if (held.has(clientId)) return null;
      const lease = `lease-${++counter}`;
      held.set(clientId, lease);
      return lease;
    },
    async release(clientId, lease) {
      if (held.get(clientId) === lease) held.delete(clientId);
    },
  };
  return { lock, held };
}

type TaskRow = { type: string; title: string; payload: Record<string, unknown>; status: string };

/** In-memory SetupStore with the same semantics as the SQL (dedupe, closing tasks). */
export function memorySetupStore(connection: Partial<SetupContext['connection']> = {}) {
  const state: SetupContext = {
    client: { id: CLIENT_ID, name: 'Peluquería Luna', whatsapp: '573001112233' },
    connection: {
      status: 'pending',
      pageId: '100000000000001',
      igId: null,
      adAccountId: null,
      pageAssignedAt: null,
      messageDestinations: [],
      encryptedToken: null,
      tokenExpiresAt: new Date(NOW.getTime() + 30 * 86_400_000),
      ...connection,
    },
  };
  const tasks: TaskRow[] = [];
  const audit: AuditEntry[] = [];
  const store: SetupStore = {
    async getContext() {
      return structuredClone(state);
    },
    async saveAdAccount({ adAccountId, igId }) {
      state.connection.adAccountId = adAccountId;
      state.connection.igId = igId;
      audit.push({
        actorType: 'system',
        action: 'meta.setup.ad_account_saved',
        entityId: adAccountId,
      });
    },
    async markPageAssigned({ how, now }) {
      state.connection.pageAssignedAt = now;
      audit.push({ actorType: 'system', action: 'meta.setup.page_assigned', after: { how } });
    },
    async markConnected(input) {
      Object.assign(state.connection, {
        status: 'connected',
        adAccountId: input.adAccountId,
        pageId: input.pageId,
        igId: input.igId,
        messageDestinations: input.destinations,
      });
      for (const task of tasks) {
        if (task.type.startsWith('meta.') && ['open', 'in_progress'].includes(task.status)) {
          task.status = 'done';
        }
      }
      audit.push({ actorType: 'system', action: 'meta.connected' });
    },
    async recordNeedsAction({ codes, tasks: drafts }) {
      state.connection.status = 'needs_action';
      audit.push({ actorType: 'system', action: 'meta.setup.needs_action', after: { codes } });
      for (const draft of drafts) {
        const open = tasks.some(
          (t) => t.type === draft.type && ['open', 'in_progress'].includes(t.status),
        );
        if (!open) tasks.push({ ...draft, status: 'open' });
      }
    },
    async audit(entry) {
      audit.push(entry);
    },
  };
  return { store, state, tasks, audit };
}
