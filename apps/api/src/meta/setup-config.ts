import { resolveMetaConfig } from '@fluvia/meta';
import type { Bindings } from '../env';

export type SetupConfig = {
  businessId: string;
  systemUserId: string;
  timezoneId: number;
  endAdvertiser: string;
  mediaAgency: string;
  partner: string;
};

export type SetupConfigResult =
  { ok: true; config: SetupConfig } | { ok: false; missing: string[] };

const blank = (value: string | undefined) => value?.trim() || undefined;

/**
 * In live mode these must be provided (they are decisions the team has not taken yet:
 * docs/plan-meta.md §8.1 and §18). Nothing is invented: if one is missing the setup stops
 * with a CONFIG_MISSING task. Mock and sandbox never create real accounts, so they get
 * clearly fake placeholders.
 */
export function resolveSetupConfig(env: Bindings): SetupConfigResult {
  const live = resolveMetaConfig(env).mode === 'live';
  const missing: string[] = [];

  const read = (name: keyof Bindings, placeholder: string): string => {
    const value = blank(env[name] as string | undefined);
    if (value) return value;
    if (live) missing.push(name);
    return placeholder;
  };

  const businessId = read('META_BUSINESS_ID', '1100000000000001');
  const systemUserId = read('META_SYSTEM_USER_ID', '1200000000000001');
  const timezone = read('META_AD_ACCOUNT_TIMEZONE_ID', '1');
  const endAdvertiser = read('META_END_ADVERTISER', 'NONE');
  const mediaAgency = read('META_MEDIA_AGENCY', 'NONE');
  const partner = read('META_PARTNER', 'NONE');

  const timezoneId = Number(timezone);
  if (!Number.isInteger(timezoneId) || timezoneId <= 0) {
    if (!missing.includes('META_AD_ACCOUNT_TIMEZONE_ID'))
      missing.push('META_AD_ACCOUNT_TIMEZONE_ID');
  }
  if (!/^\d+$/.test(businessId) && !missing.includes('META_BUSINESS_ID'))
    missing.push('META_BUSINESS_ID');
  if (!/^\d+$/.test(systemUserId) && !missing.includes('META_SYSTEM_USER_ID')) {
    missing.push('META_SYSTEM_USER_ID');
  }

  if (missing.length > 0) return { ok: false, missing };
  return {
    ok: true,
    config: { businessId, systemUserId, timezoneId, endAdvertiser, mediaAgency, partner },
  };
}
