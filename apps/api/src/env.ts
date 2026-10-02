import type { Db } from '@fluvia/db';
import type { ConnectionStore } from './meta/store';

export type Bindings = {
  APP_VERSION: string;
  /** development | staging | production. Set per environment in wrangler.toml. */
  ENVIRONMENT: string;
  /** mock | sandbox | live (live only when ENVIRONMENT=production). */
  META_MODE?: string;
  META_MOCK_SCENARIO?: string;
  /** Facebook Login for Business configuration id (non-secret, per environment). */
  META_LOGIN_CONFIG_ID?: string;
  /** Public origins, no trailing slash: where the web lives and where this API is reachable. */
  WEB_BASE_URL?: string;
  API_BASE_URL?: string;
  /** Secrets: 32 random bytes in base64 / long random strings. See .dev.vars.example. */
  TOKEN_ENCRYPTION_KEY?: string;
  OAUTH_STATE_SECRET?: string;
  INTERNAL_API_TOKEN?: string;
  DATABASE_URL: string;
  META_APP_ID: string;
  META_APP_SECRET: string;
  META_SYSTEM_USER_TOKEN: string;
  META_BUSINESS_ID: string;
  META_SANDBOX_AD_ACCOUNT_ID: string;
  COLOCA_API_KEY: string;
  COLOCA_WEBHOOK_SECRET: string;
  KAPSO_API_KEY: string;
  KAPSO_WEBHOOK_SECRET: string;
  ALEGRA_USER: string;
  ALEGRA_TOKEN: string;
  ANTHROPIC_API_KEY: string;
  EVENTS_QUEUE: Queue;
  ASSETS: R2Bucket;
  CLIENT_LOCK: DurableObjectNamespace;
};

export type Variables = {
  requestId: string;
  /** Lazy: the connection is only created when a route asks for it. */
  getDb: () => Db;
  getStore: () => ConnectionStore;
};

export type AppEnv = { Bindings: Bindings; Variables: Variables };
