import type { Db } from '@fluvia/db';

export type Bindings = {
  APP_VERSION: string;
  /** development | staging | production. Set per environment in wrangler.toml. */
  ENVIRONMENT: string;
  /** mock | sandbox | live (live only when ENVIRONMENT=production). */
  META_MODE?: string;
  META_MOCK_SCENARIO?: string;
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
};

export type AppEnv = { Bindings: Bindings; Variables: Variables };
