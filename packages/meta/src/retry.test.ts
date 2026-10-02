import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RETRY_POLICY,
  MetaApiError,
  MetaNetworkError,
  backoffDelayMs,
  isRetryable,
  withRetry,
} from './index';

const policy = DEFAULT_RETRY_POLICY;
const noWait = { sleep: async () => {}, random: () => 1 };

const metaError = (code: number, status = 400) =>
  new MetaApiError({ status, headers: {}, body: { error: { message: 'x', code } } });

describe('backoffDelayMs', () => {
  it('grows exponentially up to the cap (full jitter at the ceiling)', () => {
    expect(backoffDelayMs(1, policy, () => 1)).toBe(500);
    expect(backoffDelayMs(2, policy, () => 1)).toBe(1000);
    expect(backoffDelayMs(3, policy, () => 1)).toBe(2000);
    expect(backoffDelayMs(10, policy, () => 1)).toBe(2000);
  });

  it('is random between 0 and the ceiling', () => {
    expect(backoffDelayMs(2, policy, () => 0)).toBe(0);
    expect(backoffDelayMs(2, policy, () => 0.5)).toBe(500);
  });
});

describe('isRetryable', () => {
  it('retries transient Meta errors and network failures only', () => {
    expect(isRetryable(metaError(2))).toBe(true);
    expect(isRetryable(metaError(1, 500))).toBe(true);
    expect(isRetryable(new MetaNetworkError(new Error('reset')))).toBe(true);
    for (const code of [4, 17, 80004, 190, 200, 100, 368]) {
      expect(isRetryable(metaError(code)), String(code)).toBe(false);
    }
    expect(isRetryable(new Error('boom'))).toBe(false);
  });
});

describe('withRetry', () => {
  it('succeeds after transient failures and sleeps with the backoff', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const result = await withRetry(
      async () => {
        if (++calls < 3) throw metaError(2);
        return 'ok';
      },
      policy,
      { sleep: async (ms) => void sleeps.push(ms), random: () => 1 },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
    expect(sleeps).toEqual([500, 1000]);
  });

  it('gives up after maxRetries and throws the last error', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw metaError(2);
        },
        policy,
        noWait,
      ),
    ).rejects.toBeInstanceOf(MetaApiError);
    expect(calls).toBe(1 + policy.maxRetries);
  });

  it.each([4, 80004, 190, 200, 100, 368])('does not retry code %i', async (code) => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw metaError(code);
        },
        policy,
        noWait,
      ),
    ).rejects.toBeInstanceOf(MetaApiError);
    expect(calls).toBe(1);
  });
});
