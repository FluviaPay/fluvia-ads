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
  return c.json(
    {
      status: dbOk ? 'ok' : 'degraded',
      version: c.env.APP_VERSION,
      db: { ok: dbOk, latency_ms: Date.now() - start },
    },
    dbOk ? 200 : 503,
  );
});
