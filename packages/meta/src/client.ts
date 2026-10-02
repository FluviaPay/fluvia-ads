import { MetaApiError } from './errors';
import { MetaConfigError, resolveMetaConfig, type MetaConfig, type MetaEnv } from './config';
import { withSandbox } from './sandbox';
import { createHttpTransport } from './transports/http';
import { createMockTransport } from './transports/mock';
import type { MetaRequest, MetaResponse, MetaTransport } from './transport';

/** Ad account returned by the mock fixtures. */
export const MOCK_AD_ACCOUNT_ID = 'act_1000000000000001';

const SAFE_PATH = /^\/[A-Za-z0-9_\-./]+$/;

export type MetaClient = {
  mode: MetaConfig['mode'];
  get(path: string, query?: Record<string, string>): Promise<MetaResponse>;
  post(path: string, body?: unknown, query?: Record<string, string>): Promise<MetaResponse>;
  /** Ad account to use for campaign calls: always the sandbox one in sandbox mode. */
  resolveAdAccountId(requested?: string): string;
};

const withPrefix = (id: string) => (id.startsWith('act_') ? id : `act_${id}`);

function buildTransport(config: MetaConfig, deps: { fetch?: typeof fetch }): MetaTransport {
  const http = (token: string) =>
    createHttpTransport({ token, ...(deps.fetch ? { fetch: deps.fetch } : {}) });
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
export function createMetaClient(env: MetaEnv, deps: { fetch?: typeof fetch } = {}): MetaClient {
  const config = resolveMetaConfig(env);
  const transport = buildTransport(config, deps);

  async function send(req: MetaRequest): Promise<MetaResponse> {
    if (!SAFE_PATH.test(req.path) || req.path.includes('..')) {
      throw new Error(`Invalid Meta path: ${req.path}`);
    }
    const res = await transport(req);
    if (res.status >= 200 && res.status < 300) return res;
    throw new MetaApiError(res);
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
