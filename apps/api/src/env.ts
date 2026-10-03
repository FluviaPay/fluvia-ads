import type { Db } from '@fluvia/db';
import type { AuthDeps } from './auth/service';
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
  /** Staff login: HMAC key (>= 32 chars), email provider key, sender address. */
  AUTH_SECRET?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  /**
   * Needed to create the client's ad account in Fluvia's portfolio (live mode only).
   * Values still to be decided by the team: docs/plan-meta.md §8.1 and §18.
   */
  META_SYSTEM_USER_ID?: string;
  /** Meta's numeric id for America/Bogota (not the IANA name). */
  META_AD_ACCOUNT_TIMEZONE_ID?: string;
  META_END_ADVERTISER?: string;
  META_MEDIA_AGENCY?: string;
  META_PARTNER?: string;
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
  RATE_LIMITER?: DurableObjectNamespace;
};

export type Variables = {
  requestId: string;
  /** Lazy: the connection is only created when a route asks for it. */
  getDb: () => Db;
  getStore: () => ConnectionStore;
  /** Staff login dependencies; throws NotConfiguredError (503) when the secrets are missing. */
  getAuth: () => AuthDeps;
};

export type AppEnv = { Bindings: Bindings; Variables: Variables };
