import { describe, expect, it } from 'vitest';
import { parseUsage, usageLevel } from './index';

const app = JSON.stringify({ call_count: 30, total_cputime: 10, total_time: 20 });
const buc = JSON.stringify({
  '1000000000000001': [
    {
      type: 'ads_management',
      call_count: 80,
      total_cputime: 25,
      total_time: 25,
      estimated_time_to_regain_access: 15,
    },
  ],
});
const account = JSON.stringify({
  acc_id_util_pct: 100,
  reset_time_duration: 300,
  ads_api_access_tier: 'development_access',
});

describe('parseUsage', () => {
  it('returns an empty usage when there are no headers', () => {
    expect(parseUsage({})).toEqual({
      app: undefined,
      businessUseCases: [],
      adAccount: undefined,
      maxPct: 0,
      retryAfterMs: undefined,
    });
  });

  it('reads the three headers', () => {
    const usage = parseUsage({
      'x-app-usage': app,
      'x-business-use-case-usage': buc,
      'x-ad-account-usage': account,
    });
    expect(usage.app).toEqual({ callCount: 30, totalCpuTime: 10, totalTime: 20 });
    expect(usage.businessUseCases).toEqual([
      {
        accountId: '1000000000000001',
        type: 'ads_management',
        callCount: 80,
        totalCpuTime: 25,
        totalTime: 25,
        regainAccessMs: 15 * 60_000,
      },
    ]);
    expect(usage.adAccount).toEqual({
      utilizationPct: 100,
      resetMs: 300_000,
      accessTier: 'development_access',
    });
    expect(usage.maxPct).toBe(100);
  });

  it('retryAfterMs is the longest wait Meta asked for', () => {
    // 15 min (business use case) beats 300 s (ad account at 100 %).
    expect(
      parseUsage({ 'x-business-use-case-usage': buc, 'x-ad-account-usage': account }).retryAfterMs,
    ).toBe(900_000);
  });

  it('only waits for the ad account reset when the account is saturated', () => {
    const half = JSON.stringify({ acc_id_util_pct: 50, reset_time_duration: 300 });
    expect(parseUsage({ 'x-ad-account-usage': half }).retryAfterMs).toBeUndefined();
    expect(parseUsage({ 'x-ad-account-usage': account }).retryAfterMs).toBe(300_000);
  });

  it('ignores malformed headers instead of throwing', () => {
    const usage = parseUsage({
      'x-app-usage': 'not json',
      'x-business-use-case-usage': '{"a": 1}',
      'x-ad-account-usage': '[]',
    });
    expect(usage.app).toBeUndefined();
    expect(usage.businessUseCases).toEqual([]);
    expect(usage.adAccount).toBeUndefined();
    expect(usage.maxPct).toBe(0);
  });
});

describe('usageLevel', () => {
  const level = (pct: number) =>
    usageLevel(parseUsage({ 'x-ad-account-usage': JSON.stringify({ acc_id_util_pct: pct }) }));

  it.each([
    [0, 'ok'],
    [74, 'ok'],
    [75, 'warn'],
    [89, 'warn'],
    [90, 'critical'],
    [100, 'critical'],
  ])('%i%% is %s', (pct, expected) => {
    expect(level(pct)).toBe(expected);
  });
});
