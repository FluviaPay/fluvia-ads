import { describe, expect, it } from 'vitest';
import type { Bindings } from '../env';
import { resolveSetupConfig } from './setup-config';

const env = (extra: Record<string, string> = {}) =>
  ({ ENVIRONMENT: 'development', META_MODE: 'mock', ...extra }) as unknown as Bindings;

const liveEnv = (extra: Record<string, string> = {}) =>
  env({
    ENVIRONMENT: 'production',
    META_MODE: 'live',
    META_SYSTEM_USER_TOKEN: 'EAAFAKETOKEN',
    ...extra,
  });

const complete = {
  META_BUSINESS_ID: '1100000000000001',
  META_SYSTEM_USER_ID: '1200000000000001',
  META_AD_ACCOUNT_TIMEZONE_ID: '99',
  META_END_ADVERTISER: 'NONE',
  META_MEDIA_AGENCY: 'NONE',
  META_PARTNER: 'NONE',
};

describe('resolveSetupConfig', () => {
  it('mock and sandbox get fake placeholders: nothing real is ever created there', () => {
    expect(resolveSetupConfig(env())).toMatchObject({ ok: true });
    const sandbox = env({
      META_MODE: 'sandbox',
      ENVIRONMENT: 'staging',
      META_SYSTEM_USER_TOKEN: 'EAAFAKETOKEN',
      META_SANDBOX_AD_ACCOUNT_ID: '555',
    });
    expect(resolveSetupConfig(sandbox)).toMatchObject({ ok: true });
  });

  it('live with everything set resolves the config (timezone as a number)', () => {
    expect(resolveSetupConfig(liveEnv(complete))).toEqual({
      ok: true,
      config: {
        businessId: '1100000000000001',
        systemUserId: '1200000000000001',
        timezoneId: 99,
        endAdvertiser: 'NONE',
        mediaAgency: 'NONE',
        partner: 'NONE',
      },
    });
  });

  it('live names every missing value and invents none', () => {
    expect(resolveSetupConfig(liveEnv())).toEqual({
      ok: false,
      missing: [
        'META_BUSINESS_ID',
        'META_SYSTEM_USER_ID',
        'META_AD_ACCOUNT_TIMEZONE_ID',
        'META_END_ADVERTISER',
        'META_MEDIA_AGENCY',
        'META_PARTNER',
      ],
    });
  });

  it('live treats blank values as missing', () => {
    const result = resolveSetupConfig(liveEnv({ ...complete, META_PARTNER: '  ' }));
    expect(result).toEqual({ ok: false, missing: ['META_PARTNER'] });
  });

  it.each(['abc', '0', '-3', '1.5'])('live rejects the timezone id %j', (value) => {
    const result = resolveSetupConfig(liveEnv({ ...complete, META_AD_ACCOUNT_TIMEZONE_ID: value }));
    expect(result).toEqual({ ok: false, missing: ['META_AD_ACCOUNT_TIMEZONE_ID'] });
  });

  it('live rejects non-numeric business or system user ids', () => {
    expect(resolveSetupConfig(liveEnv({ ...complete, META_BUSINESS_ID: 'x/y' }))).toEqual({
      ok: false,
      missing: ['META_BUSINESS_ID'],
    });
  });
});
