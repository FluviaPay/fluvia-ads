import { resolveMetaConfig } from '@fluvia/meta';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { log } from '../logger';

export const health = new Hono<AppEnv>();

health.get('/health', async (c) => {
  const start = Date.now();
  let dbOk = true;
  try {
    await c.var.getDb().execute(sql`select 1`);
  } catch (err) {
    dbOk = false;
    log('error', 'db_ping_failed', {
      request_id: c.get('requestId'),
      error: err instanceof Error ? err.message : 'unknown',
    });
  }
  const dbLatency = Date.now() - start;

  let metaMode: string | null = null;
  try {
    metaMode = resolveMetaConfig(c.env).mode;
  } catch (err) {
    log('error', 'meta_config_invalid', {
      request_id: c.get('requestId'),
      error: err instanceof Error ? err.message : 'unknown',
    });
  }

  const ok = dbOk && metaMode !== null;
  return c.json(
    {
      status: ok ? 'ok' : 'degraded',
      version: c.env.APP_VERSION,
      environment: c.env.ENVIRONMENT,
      db: { ok: dbOk, latency_ms: dbLatency },
      meta: { ok: metaMode !== null, mode: metaMode },
    },
    ok ? 200 : 503,
  );
});
