import { z } from 'zod';

/** Outcome of the Meta connection flow, shared by the API (producer) and the web (reader). */
export const connectStatusSchema = z.enum([
  'ok',
  'needs_action',
  'cancelled',
  'invalid_state',
  'error',
]);
export type ConnectStatus = z.infer<typeof connectStatusSchema>;

/** Why a connection needs action. Codes match docs/plan-meta.md §7. */
export const connectReasonSchema = z.enum([
  'PERMISSIONS_MISSING',
  'PAGE_NOT_ADMIN',
  'PAGE_UNPUBLISHED',
  'NO_PAGE',
  'MULTIPLE_PAGES',
]);
export type ConnectReason = z.infer<typeof connectReasonSchema>;

export type ConnectResult = {
  status: ConnectStatus;
  reasons: ConnectReason[];
  /** Signed single-use state to try again (not sent when the link itself is invalid). */
  retryState?: string | undefined;
};

/** Only codes travel in the URL: never names, ids of pages or tokens. */
export function encodeConnectResult(result: ConnectResult): string {
  const params = new URLSearchParams({ status: result.status });
  if (result.reasons.length > 0) params.set('reasons', result.reasons.join(','));
  if (result.retryState) params.set('retry', result.retryState);
  return params.toString();
}

/** Tolerant: anything unexpected becomes a generic `error`. */
export function decodeConnectResult(search: string): ConnectResult {
  const params = new URLSearchParams(search);
  const status = connectStatusSchema.safeParse(params.get('status'));
  if (!status.success) return { status: 'error', reasons: [] };

  const reasons = (params.get('reasons') ?? '')
    .split(',')
    .map((r) => connectReasonSchema.safeParse(r))
    .flatMap((r) => (r.success ? [r.data] : []));
  const retry = params.get('retry');
  return { status: status.data, reasons, ...(retry ? { retryState: retry } : {}) };
}
