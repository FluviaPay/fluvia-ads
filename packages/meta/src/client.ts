import { MetaApiError, MetaNetworkError } from './errors';
import { MetaConfigError, resolveMetaConfig, type MetaConfig, type MetaEnv } from './config';
import {
  DEFAULT_RETRY_POLICY,
  defaultRetryDeps,
  withRetry,
  type RetryDeps,
  type RetryPolicy,
} from './retry';
import { MetaSandboxViolation, withSandbox } from './sandbox';
import { createHttpTransport } from './transports/http';
import { createMockTransport } from './transports/mock';
import type { MetaRequest, MetaResponse, MetaTransport } from './transport';
import { hasUsage, parseUsage, type MetaUsage } from './usage';

/** Ad account returned by the mock fixtures. */
export const MOCK_AD_ACCOUNT_ID = 'act_1000000000000001';

const SAFE_PATH = /^\/[A-Za-z0-9_\-./]+$/;

export type MetaResult = MetaResponse & { usage: MetaUsage };

export type MetaClientOptions = {
  fetch?: typeof fetch;
  /** Overrides for the in-request retry policy (reads only). */
  retry?: Partial<RetryPolicy>;
  sleep?: RetryDeps['sleep'];
  random?: RetryDeps['random'];
  timeoutMs?: number;
  /** Called for every response that carries usage headers (success or error). Must not throw. */
  onUsage?: (usage: MetaUsage, call: { method: string; path: string }) => void;
};

export type MetaClient = {
  mode: MetaConfig['mode'];
  get(path: string, query?: Record<string, string>): Promise<MetaResult>;
  post(path: string, body?: unknown, query?: Record<string, string>): Promise<MetaResult>;
  /** Ad account to use for campaign calls: always the sandbox one in sandbox mode. */
  resolveAdAccountId(requested?: string): string;
};

const withPrefix = (id: string) => (id.startsWith('act_') ? id : `act_${id}`);

function buildTransport(config: MetaConfig, options: MetaClientOptions): MetaTransport {
  const http = (token: string) =>
    createHttpTransport({
      token,
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    });
  switch (config.mode) {
    case 'mock':
      return createMockTransport(config.scenario);
    case 'sandbox':
      return withSandbox(http(config.token), config.sandboxAdAccountId);
    case 'live':
      return http(config.token);
  }
}

/** The only way the rest of the codebase talks to Meta (rule: everything goes through packages/meta). */
export function createMetaClient(env: MetaEnv, options: MetaClientOptions = {}): MetaClient {
  const config = resolveMetaConfig(env);
  const transport = buildTransport(config, options);
  const policy: RetryPolicy = { ...DEFAULT_RETRY_POLICY, ...options.retry };
  const deps: RetryDeps = {
    sleep: options.sleep ?? defaultRetryDeps.sleep,
    random: options.random ?? defaultRetryDeps.random,
  };

  function notify(usage: MetaUsage, req: MetaRequest) {
    if (!options.onUsage || !hasUsage(usage)) return;
    try {
      options.onUsage(usage, { method: req.method, path: req.path });
    } catch {
      // A broken observer must never break a Meta call.
    }
  }

  async function attempt(req: MetaRequest): Promise<MetaResult> {
    let res: MetaResponse;
    try {
      res = await transport(req);
    } catch (err) {
      if (err instanceof MetaSandboxViolation) throw err;
      throw new MetaNetworkError(err);
    }
    const usage = parseUsage(res.headers);
    notify(usage, req);
    if (res.status >= 200 && res.status < 300) return { ...res, usage };
    throw new MetaApiError(res);
  }

  async function send(req: MetaRequest): Promise<MetaResult> {
    if (!SAFE_PATH.test(req.path) || req.path.includes('..')) {
      throw new Error(`Invalid Meta path: ${req.path}`);
    }
    // Writes are never retried blindly: Meta has no idempotency key (docs/plan-meta.md §8.3).
    return req.method === 'GET' ? withRetry(() => attempt(req), policy, deps) : attempt(req);
  }

  return {
    mode: config.mode,
    get: (path, query) => send({ method: 'GET', path, query }),
    post: (path, body, query) => send({ method: 'POST', path, body, query }),
    resolveAdAccountId(requested) {
      if (config.mode === 'sandbox') return `act_${config.sandboxAdAccountId}`;
      if (requested) return withPrefix(requested);
      if (config.mode === 'mock') return MOCK_AD_ACCOUNT_ID;
      throw new MetaConfigError('An ad account id is required in live mode');
    },
  };
}
