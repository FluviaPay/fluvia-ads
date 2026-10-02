import { z } from 'zod';
import { SCENARIOS, type ScenarioName } from './scenarios';

export class MetaConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetaConfigError';
  }
}

export type MetaEnv = {
  ENVIRONMENT?: string | undefined;
  META_MODE?: string | undefined;
  META_MOCK_SCENARIO?: string | undefined;
  META_SANDBOX_AD_ACCOUNT_ID?: string | undefined;
  META_SYSTEM_USER_TOKEN?: string | undefined;
};

export type MetaEnvironment = 'development' | 'staging' | 'production';

export type MetaConfig =
  | { mode: 'mock'; environment: MetaEnvironment; scenario: ScenarioName }
  | { mode: 'sandbox'; environment: MetaEnvironment; sandboxAdAccountId: string; token: string }
  | { mode: 'live'; environment: 'production'; token: string };

const modeSchema = z.enum(['mock', 'sandbox', 'live']);
const environmentSchema = z.enum(['development', 'staging', 'production']);
const scenarioSchema = z.enum(SCENARIOS);
const adAccountIdSchema = z
  .string()
  .regex(/^(act_)?\d+$/)
  .transform((v) => v.replace(/^act_/, ''));

const blank = (value: string | undefined) => value?.trim() || undefined;

function read<S extends z.ZodType>(
  schema: S,
  name: string,
  raw: string | undefined,
  expected: string,
): z.output<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new MetaConfigError(`${name} is invalid: expected ${expected}`);
  return parsed.data;
}

/**
 * Resolves and validates the Meta mode. Fails fast; never echoes secret values.
 * - unset META_MODE means `mock`, and unset ENVIRONMENT means `development` (the safe sides).
 * - `live` is only allowed when ENVIRONMENT is `production`.
 */
export function resolveMetaConfig(env: MetaEnv): MetaConfig {
  const mode = read(
    modeSchema,
    'META_MODE',
    blank(env.META_MODE) ?? 'mock',
    'mock | sandbox | live',
  );
  const environment = read(
    environmentSchema,
    'ENVIRONMENT',
    blank(env.ENVIRONMENT) ?? 'development',
    'development | staging | production',
  );
  const token = blank(env.META_SYSTEM_USER_TOKEN);

  switch (mode) {
    case 'mock': {
      const scenario = read(
        scenarioSchema,
        'META_MOCK_SCENARIO',
        blank(env.META_MOCK_SCENARIO) ?? 'happy',
        SCENARIOS.join(' | '),
      );
      return { mode, environment, scenario };
    }
    case 'sandbox': {
      const rawId = blank(env.META_SANDBOX_AD_ACCOUNT_ID);
      if (!rawId)
        throw new MetaConfigError('META_MODE=sandbox requires META_SANDBOX_AD_ACCOUNT_ID');
      if (!token) throw new MetaConfigError('META_MODE=sandbox requires META_SYSTEM_USER_TOKEN');
      const sandboxAdAccountId = read(
        adAccountIdSchema,
        'META_SANDBOX_AD_ACCOUNT_ID',
        rawId,
        'digits, optionally prefixed with act_',
      );
      return { mode, environment, sandboxAdAccountId, token };
    }
    case 'live': {
      if (environment !== 'production') {
        throw new MetaConfigError(
          `META_MODE=live is only allowed when ENVIRONMENT=production (got ${environment})`,
        );
      }
      if (!token) throw new MetaConfigError('META_MODE=live requires META_SYSTEM_USER_TOKEN');
      return { mode, environment, token };
    }
  }
}
