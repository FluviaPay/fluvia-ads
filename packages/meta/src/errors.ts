import { z } from 'zod';
import type { MetaResponse } from './transport';

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
    this.category = classifyMetaError(res.status, err?.code);
  }
}
