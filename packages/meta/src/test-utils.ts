import { vi } from 'vitest';
import { createMetaClient, type MetaClient, type MetaClientOptions } from './client';

export const liveEnv = {
  META_MODE: 'live',
  ENVIRONMENT: 'production',
  META_SYSTEM_USER_TOKEN: 'EAAFAKETOKEN',
};

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers });

export const graphError = (code: number, status = 400, extra: Record<string, unknown> = {}) =>
  json(
    { error: { message: `fixture error ${code}`, type: 'OAuthException', code, ...extra } },
    status,
  );

type Step =
  Response | Error | ((call: { method: string; path: string; body: unknown }) => Response);

/** A fetch that replays a script of responses (or failures) and records every call. */
export function scriptedFetch(script: Step[]) {
  const calls: {
    method: string;
    path: string;
    query: URLSearchParams;
    body: unknown;
    headers: Record<string, string>;
  }[] = [];
  const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    const call = {
      method: init?.method ?? 'GET',
      path: url.pathname.replace(/^\/v[\d.]+/, ''),
      query: url.searchParams,
      body,
      headers: (init?.headers ?? {}) as Record<string, string>,
    };
    calls.push(call);
    const step = script.shift();
    if (!step) throw new Error(`Unexpected call: ${call.method} ${call.path}`);
    if (step instanceof Error) throw step;
    return typeof step === 'function' ? step(call) : step;
  });
  return { fetch: fetchFn, calls, remaining: () => script.length };
}

/** A live-mode client over a scripted fetch, with no real waiting and deterministic jitter. */
export function liveClient(
  fetchFn: typeof fetch,
  extra: MetaClientOptions = {},
): { client: MetaClient; sleeps: number[] } {
  const sleeps: number[] = [];
  const client = createMetaClient(liveEnv, {
    fetch: fetchFn,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 1,
    ...extra,
  });
  return { client, sleeps };
}
