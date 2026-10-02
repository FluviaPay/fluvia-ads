import { z } from 'zod';

/** Usage headers per docs/plan-meta.md §12. Field names UNCONFIRMED (🔶) against Meta's docs. */
const num = z.number();

const appUsageSchema = z.object({ call_count: num, total_cputime: num, total_time: num });

const businessUseCaseSchema = z.record(
  z.string(),
  z.array(
    z.object({
      type: z.string(),
      call_count: num,
      total_cputime: num,
      total_time: num,
      estimated_time_to_regain_access: num.optional(),
    }),
  ),
);

const adAccountUsageSchema = z.object({
  acc_id_util_pct: num,
  reset_time_duration: num.optional(),
  ads_api_access_tier: z.string().optional(),
});

export type MetaUsage = {
  app: { callCount: number; totalCpuTime: number; totalTime: number } | undefined;
  businessUseCases: {
    accountId: string;
    type: string;
    callCount: number;
    totalCpuTime: number;
    totalTime: number;
    regainAccessMs: number | undefined;
  }[];
  adAccount:
    | {
        utilizationPct: number;
        resetMs: number | undefined;
        accessTier: string | undefined;
      }
    | undefined;
  /** Highest usage percentage found in any header (0 when there are none). */
  maxPct: number;
  /** How long Meta says to wait before calling again, when it says so. */
  retryAfterMs: number | undefined;
};

export const USAGE_WARN_PCT = 75;
export const USAGE_CRITICAL_PCT = 90;

function readJson<T>(schema: z.ZodType<T>, raw: string | undefined): T | undefined {
  if (!raw) return undefined;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Never throws: a malformed header is ignored so it cannot break a working call. */
export function parseUsage(headers: Record<string, string>): MetaUsage {
  const app = readJson(appUsageSchema, headers['x-app-usage']);
  const buc = readJson(businessUseCaseSchema, headers['x-business-use-case-usage']);
  const account = readJson(adAccountUsageSchema, headers['x-ad-account-usage']);

  const businessUseCases = Object.entries(buc ?? {}).flatMap(([accountId, entries]) =>
    entries.map((e) => ({
      accountId,
      type: e.type,
      callCount: e.call_count,
      totalCpuTime: e.total_cputime,
      totalTime: e.total_time,
      // Meta reports minutes.
      regainAccessMs:
        e.estimated_time_to_regain_access === undefined
          ? undefined
          : e.estimated_time_to_regain_access * 60_000,
    })),
  );

  const adAccount = account && {
    utilizationPct: account.acc_id_util_pct,
    // Meta reports seconds.
    resetMs:
      account.reset_time_duration === undefined ? undefined : account.reset_time_duration * 1000,
    accessTier: account.ads_api_access_tier,
  };

  const percentages = [
    ...(app ? [app.call_count, app.total_cputime, app.total_time] : []),
    ...businessUseCases.flatMap((b) => [b.callCount, b.totalCpuTime, b.totalTime]),
    ...(adAccount ? [adAccount.utilizationPct] : []),
  ];

  const waits = [
    ...businessUseCases.map((b) => b.regainAccessMs),
    adAccount && adAccount.utilizationPct >= 100 ? adAccount.resetMs : undefined,
  ].filter((ms): ms is number => ms !== undefined && ms > 0);

  return {
    app: app && {
      callCount: app.call_count,
      totalCpuTime: app.total_cputime,
      totalTime: app.total_time,
    },
    businessUseCases,
    adAccount,
    maxPct: percentages.length ? Math.max(...percentages) : 0,
    retryAfterMs: waits.length ? Math.max(...waits) : undefined,
  };
}

export const hasUsage = (usage: MetaUsage) =>
  usage.app !== undefined || usage.businessUseCases.length > 0 || usage.adAccount !== undefined;

export function usageLevel(usage: MetaUsage): 'ok' | 'warn' | 'critical' {
  if (usage.maxPct >= USAGE_CRITICAL_PCT) return 'critical';
  if (usage.maxPct >= USAGE_WARN_PCT) return 'warn';
  return 'ok';
}
