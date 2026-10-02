import { MetaApiError, MetaNetworkError } from './errors';

export type RetryPolicy = { maxRetries: number; baseMs: number; capMs: number };

/** Short, in-request retries only (docs/plan-meta.md §11). Long waits go through Queues. */
export const DEFAULT_RETRY_POLICY: RetryPolicy = { maxRetries: 2, baseMs: 500, capMs: 2_000 };

export type RetryDeps = {
  sleep: (ms: number) => Promise<void>;
  random: () => number;
};

export const defaultRetryDeps: RetryDeps = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
};

/** Exponential backoff with full jitter. `retryNumber` starts at 1. */
export function backoffDelayMs(
  retryNumber: number,
  policy: RetryPolicy,
  random: () => number,
): number {
  const ceiling = Math.min(policy.capMs, policy.baseMs * 2 ** (retryNumber - 1));
  return Math.floor(random() * ceiling);
}

/**
 * Only transient Meta errors and network failures are retried. Rate limits are NOT:
 * they surface with `retryAfterMs` so the queue layer can reschedule without making
 * the penalty worse. auth / permission / invalid_request / policy never retry.
 */
export function isRetryable(err: unknown): boolean {
  return (
    err instanceof MetaNetworkError || (err instanceof MetaApiError && err.category === 'transient')
  );
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy,
  deps: RetryDeps,
): Promise<T> {
  for (let retry = 0; ; retry++) {
    try {
      return await fn();
    } catch (err) {
      if (retry >= policy.maxRetries || !isRetryable(err)) throw err;
      await deps.sleep(backoffDelayMs(retry + 1, policy, deps.random));
    }
  }
}
