import { z } from 'zod';
import type { MetaResponse } from './transport';
import { parseUsage, type MetaUsage } from './usage';

export type MetaErrorCategory =
  'transient' | 'rate_limited' | 'auth' | 'permission' | 'invalid_request' | 'policy' | 'unknown';

/** UNCONFIRMED against Meta's error reference (docs/plan-meta.md §10.3). Data, not logic. */
const CODE_CATEGORIES: Record<number, MetaErrorCategory> = {
  1: 'transient',
  2: 'transient',
  4: 'rate_limited',
  10: 'permission',
  17: 'rate_limited',
  32: 'rate_limited',
  100: 'invalid_request',
  190: 'auth',
  341: 'rate_limited',
  368: 'policy',
  613: 'rate_limited',
};

export function classifyMetaError(status: number, code?: number): MetaErrorCategory {
  if (code !== undefined) {
    const exact = CODE_CATEGORIES[code];
    if (exact) return exact;
    if (code >= 200 && code <= 299) return 'permission';
    if (code >= 80000 && code <= 80014) return 'rate_limited';
  }
  if (status === 401) return 'auth';
  if (status === 403) return 'permission';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'transient';
  return 'unknown';
}

const errorBodySchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.string().optional(),
    code: z.number().optional(),
    error_subcode: z.number().optional(),
    fbtrace_id: z.string().optional(),
  }),
});

export class MetaApiError extends Error {
  readonly status: number;
  readonly category: MetaErrorCategory;
  readonly code: number | undefined;
  readonly subcode: number | undefined;
  readonly fbtraceId: string | undefined;
  /** Response headers (usage headers drive rate limiting). */
  readonly headers: Record<string, string>;
  readonly usage: MetaUsage;
  /** When Meta says how long to wait (rate limits). The queue layer uses it to reschedule. */
  readonly retryAfterMs: number | undefined;

  constructor(res: MetaResponse) {
    const parsed = errorBodySchema.safeParse(res.body);
    const err = parsed.success ? parsed.data.error : undefined;
    super(err?.message ?? `Meta request failed with status ${res.status}`);
    this.name = 'MetaApiError';
    this.status = res.status;
    this.code = err?.code;
    this.subcode = err?.error_subcode;
    this.fbtraceId = err?.fbtrace_id;
    this.headers = res.headers;
    this.usage = parseUsage(res.headers);
    this.retryAfterMs = this.usage.retryAfterMs;
    this.category = classifyMetaError(res.status, err?.code);
  }
}

/** The request never got a response (DNS, connection reset, timeout). Retryable for reads. */
export class MetaNetworkError extends Error {
  readonly category = 'transient' as const;

  constructor(cause: unknown) {
    const reason = cause instanceof Error ? `${cause.name}: ${cause.message}` : 'unknown error';
    super(`Network error calling Meta (${reason})`, { cause });
    this.name = 'MetaNetworkError';
  }
}

/** Meta answered 2xx but the body does not look like what we expect. Never retried. */
export class MetaSchemaError extends Error {
  readonly category = 'unknown' as const;

  constructor(what: string, detail: string) {
    super(`Unexpected response shape from Meta for ${what}: ${detail}`);
    this.name = 'MetaSchemaError';
  }
}

export class MetaPaginationLimitError extends Error {
  constructor(what: string, maxPages: number) {
    super(`${what} still has more results after ${maxPages} pages`);
    this.name = 'MetaPaginationLimitError';
  }
}

/** The caller passed something that cannot be a valid Meta id or value. */
export class MetaInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetaInputError';
  }
}

/** The state in Meta contradicts what we need (e.g. an existing ad account in the wrong currency). */
export class MetaConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetaConflictError';
  }
}
