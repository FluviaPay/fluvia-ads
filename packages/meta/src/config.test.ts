import { describe, expect, it } from 'vitest';
import { MetaConfigError, resolveMetaConfig } from './index';

const TOKEN = 'EAAFAKETOKENFORTESTS1234567890';

describe('resolveMetaConfig', () => {
  it('defaults to mock in development when nothing is set', () => {
    expect(resolveMetaConfig({})).toEqual({
      mode: 'mock',
      environment: 'development',
      scenario: 'happy',
    });
  });

  it('treats blank values (as in .dev.vars.example) as unset', () => {
    expect(resolveMetaConfig({ META_MODE: '', ENVIRONMENT: ' ', META_MOCK_SCENARIO: '' })).toEqual({
      mode: 'mock',
      environment: 'development',
      scenario: 'happy',
    });
  });

  it('picks the mock scenario', () => {
    const config = resolveMetaConfig({ META_MODE: 'mock', META_MOCK_SCENARIO: 'rate-limited' });
    expect(config).toMatchObject({ mode: 'mock', scenario: 'rate-limited' });
  });

  it('rejects unknown modes, environments and scenarios', () => {
    expect(() => resolveMetaConfig({ META_MODE: 'prod' })).toThrow(MetaConfigError);
    expect(() => resolveMetaConfig({ ENVIRONMENT: 'qa' })).toThrow(MetaConfigError);
    expect(() => resolveMetaConfig({ META_MOCK_SCENARIO: 'nope' })).toThrow(MetaConfigError);
  });

  describe('sandbox', () => {
    const base = { META_MODE: 'sandbox', META_SYSTEM_USER_TOKEN: TOKEN };

    it('requires the sandbox ad account and a token', () => {
      expect(() => resolveMetaConfig(base)).toThrow(/META_SANDBOX_AD_ACCOUNT_ID/);
      expect(() =>
        resolveMetaConfig({ META_MODE: 'sandbox', META_SANDBOX_AD_ACCOUNT_ID: '123' }),
      ).toThrow(/META_SYSTEM_USER_TOKEN/);
    });

    it('normalizes the ad account id (with or without act_)', () => {
      for (const id of ['123456', 'act_123456']) {
        expect(
          resolveMetaConfig({ ...base, ENVIRONMENT: 'staging', META_SANDBOX_AD_ACCOUNT_ID: id }),
        ).toMatchObject({ mode: 'sandbox', environment: 'staging', sandboxAdAccountId: '123456' });
      }
    });

    it('rejects a malformed ad account id', () => {
      expect(() => resolveMetaConfig({ ...base, META_SANDBOX_AD_ACCOUNT_ID: 'abc' })).toThrow(
        MetaConfigError,
      );
    });
  });

  describe('live', () => {
    it.each(['development', 'staging', undefined])(
      'is refused when ENVIRONMENT=%s',
      (environment) => {
        expect(() =>
          resolveMetaConfig({
            META_MODE: 'live',
            META_SYSTEM_USER_TOKEN: TOKEN,
            ENVIRONMENT: environment,
          }),
        ).toThrow(/only allowed when ENVIRONMENT=production/);
      },
    );

    it('is allowed in production with a token', () => {
      expect(
        resolveMetaConfig({
          META_MODE: 'live',
          ENVIRONMENT: 'production',
          META_SYSTEM_USER_TOKEN: TOKEN,
        }),
      ).toMatchObject({ mode: 'live', environment: 'production' });
    });

    it('requires a token even in production', () => {
      expect(() => resolveMetaConfig({ META_MODE: 'live', ENVIRONMENT: 'production' })).toThrow(
        /META_SYSTEM_USER_TOKEN/,
      );
    });
  });

  it('never leaks secret values in error messages', () => {
    for (const env of [
      { META_MODE: 'live', ENVIRONMENT: 'staging', META_SYSTEM_USER_TOKEN: TOKEN },
      { META_MODE: 'sandbox', META_SYSTEM_USER_TOKEN: TOKEN, META_SANDBOX_AD_ACCOUNT_ID: 'bad' },
    ]) {
      expect(() => resolveMetaConfig(env)).toThrow();
      try {
        resolveMetaConfig(env);
      } catch (err) {
        expect(String(err)).not.toContain(TOKEN);
      }
    }
  });
});
