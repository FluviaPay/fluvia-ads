import { resolveMetaConfig } from '@fluvia/meta';
import { fromBase64 } from '../encoding';
import type { Bindings } from '../env';

/** Names only, never values: it ends up in the 503 body and in logs. */
export class NotConfiguredError extends Error {
  readonly missing: string[];

  constructor(missing: string[]) {
    super(`Not configured: ${missing.join(', ')}`);
    this.name = 'NotConfiguredError';
    this.missing = missing;
  }
}

export type ConnectConfig = {
  mode: 'mock' | 'sandbox' | 'live';
  tokenKey: string;
  stateSecret: string;
  internalToken: string;
  webBaseUrl: string;
  apiBaseUrl: string;
  /** Registered in the Meta app; must match exactly. */
  redirectUri: string;
  loginConfigId: string;
  appId: string;
  appSecret: string;
};

const blank = (value: string | undefined) => value?.trim() || undefined;

function origin(value: string | undefined): string | undefined {
  const raw = blank(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    return raw.replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

/**
 * Meta credentials are only required outside mock mode, so the whole flow can be run
 * locally without a Meta app (the login step then skips Facebook).
 */
export function resolveConnectConfig(env: Bindings): ConnectConfig {
  const mode = resolveMetaConfig(env).mode;
  const missing: string[] = [];
  const need = <T>(name: string, value: T | undefined): T | undefined => {
    if (value === undefined) missing.push(name);
    return value;
  };

  const long = (value: string | undefined) => {
    const v = blank(value);
    return v && v.length >= 32 ? v : undefined;
  };
  const key = blank(env.TOKEN_ENCRYPTION_KEY);
  const validKey = key && fromBase64(key)?.length === 32 ? key : undefined;

  const tokenKey = need('TOKEN_ENCRYPTION_KEY', validKey);
  const stateSecret = need('OAUTH_STATE_SECRET', long(env.OAUTH_STATE_SECRET));
  const internalToken = need('INTERNAL_API_TOKEN', long(env.INTERNAL_API_TOKEN));
  const webBaseUrl = need('WEB_BASE_URL', origin(env.WEB_BASE_URL));
  const apiBaseUrl = need('API_BASE_URL', origin(env.API_BASE_URL));

  const metaRequired = mode !== 'mock';
  const appId = blank(env.META_APP_ID) ?? (metaRequired ? undefined : 'mock-app-id');
  const appSecret = blank(env.META_APP_SECRET) ?? (metaRequired ? undefined : 'mock-app-secret');
  const loginConfigId =
    blank(env.META_LOGIN_CONFIG_ID) ?? (metaRequired ? undefined : 'mock-config-id');
  need('META_APP_ID', appId);
  need('META_APP_SECRET', appSecret);
  need('META_LOGIN_CONFIG_ID', loginConfigId);

  if (
    missing.length > 0 ||
    !tokenKey ||
    !stateSecret ||
    !internalToken ||
    !webBaseUrl ||
    !apiBaseUrl ||
    !appId ||
    !appSecret ||
    !loginConfigId
  ) {
    throw new NotConfiguredError(missing);
  }

  return {
    mode,
    tokenKey,
    stateSecret,
    internalToken,
    webBaseUrl,
    apiBaseUrl,
    redirectUri: `${apiBaseUrl}/meta/callback`,
    loginConfigId,
    appId,
    appSecret,
  };
}
