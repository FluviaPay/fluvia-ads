import { createDb } from '@fluvia/db';
import { describe, expect, it } from 'vitest';
import {
  consumeNonceQuery,
  createLinkQueries,
  outcomeQueries,
  type ConnectionOutcome,
} from './store';

// A dummy URL: building a query never connects.
const db = createDb('postgres://user:pass@localhost/db');
const sqlOf = (q: unknown) => (q as { toSQL(): { sql: string; params: unknown[] } }).toSQL();

const CLIENT = '0b6f6f9e-1c1a-4d5e-9a57-2f2f7b1b0a11';
const NOW = new Date('2026-10-02T12:00:00Z');
const retry = { nonce: 'n'.repeat(22), expiresAt: new Date('2026-10-02T12:30:00Z') };
const ENCRYPTED = 'v1.aXY.Y2lwaGVydGV4dA';

const saved = (
  patch: Partial<Extract<ConnectionOutcome, { kind: 'saved' }>> = {},
): ConnectionOutcome => ({
  kind: 'saved',
  clientId: CLIENT,
  status: 'pending',
  pageId: '100',
  igId: '200',
  permissions: ['ads_management'],
  reasons: [],
  encryptedToken: ENCRYPTED,
  tokenExpiresAt: new Date('2026-12-01T00:00:00Z'),
  retry: null,
  ...patch,
});

describe('consumeNonceQuery', () => {
  const { sql, params } = sqlOf(
    consumeNonceQuery(db, { clientId: CLIENT, nonce: 'abc', now: NOW }),
  );

  it('is ONE statement that checks nonce and expiry, clears the nonce and returns the row', () => {
    expect(sql).toMatch(/^update "meta_connections" set /);
    expect(sql).toContain('"oauth_nonce" = $');
    expect(sql).toContain('"oauth_nonce_expires_at" > $');
    expect(sql).toContain('"client_id" = $');
    expect(sql).toMatch(/returning "id"$/);
  });

  it('binds the values instead of inlining them', () => {
    expect(params).toEqual(expect.arrayContaining([CLIENT, 'abc', NOW.toISOString()]));
    expect(sql).not.toContain('abc');
  });
});

describe('createLinkQueries', () => {
  const [upsert, audit] = createLinkQueries(db, {
    clientId: CLIENT,
    nonce: 'abc',
    expiresAt: retry.expiresAt,
  });

  it('upserts on client_id (one row per client) and audits in the same batch', () => {
    expect(sqlOf(upsert).sql).toContain('insert into "meta_connections"');
    expect(sqlOf(upsert).sql).toContain('on conflict ("client_id") do update set');
    expect(sqlOf(audit).sql).toContain('insert into "audit_log"');
    expect(sqlOf(audit).params).toContain('meta.connection.link_created');
  });
});

describe('outcomeQueries', () => {
  const kinds = (o: ConnectionOutcome) =>
    outcomeQueries(db, o).map((q) => sqlOf(q).sql.split(' ').slice(0, 3).join(' '));

  it('saved/pending: update + audit, no task', () => {
    expect(kinds(saved())).toEqual(['update "meta_connections" set', 'insert into "audit_log"']);
  });

  it('saved/needs_action: update + audit + a task for the team', () => {
    const outcome = saved({ status: 'needs_action', reasons: ['PAGE_NOT_ADMIN'], retry });
    expect(kinds(outcome)).toEqual([
      'update "meta_connections" set',
      'insert into "audit_log"',
      'insert into "tasks"',
    ]);
    const task = sqlOf(outcomeQueries(db, outcome)[2]);
    expect(task.params).toContain('meta.connection.needs_action');
  });

  it("cancelled: audit but NO task (it was the client's decision)", () => {
    expect(kinds({ kind: 'cancelled', clientId: CLIENT, retry })).toEqual([
      'update "meta_connections" set',
      'insert into "audit_log"',
    ]);
  });

  it('failed: audit + task', () => {
    expect(kinds({ kind: 'failed', clientId: CLIENT, reason: 'x', retry })).toEqual([
      'update "meta_connections" set',
      'insert into "audit_log"',
      'insert into "tasks"',
    ]);
  });

  it('rejected: only an audit row', () => {
    expect(kinds({ kind: 'rejected', clientId: CLIENT, reason: 'reused_or_expired' })).toEqual([
      'insert into "audit_log"',
    ]);
  });

  it('the encrypted token goes to meta_connections only; audit/tasks never carry it', () => {
    const queries = outcomeQueries(
      db,
      saved({ status: 'needs_action', reasons: ['NO_PAGE'], retry }),
    ).map(sqlOf);
    expect(JSON.stringify(queries[0]?.params)).toContain(ENCRYPTED);
    for (const q of queries.slice(1)) {
      expect(JSON.stringify(q.params)).not.toContain(ENCRYPTED);
      expect(q.sql).not.toContain('access_token');
    }
  });

  it('writes the new retry nonce, or clears it when there is nothing to retry', () => {
    const withRetry = sqlOf(outcomeQueries(db, saved({ status: 'needs_action', retry }))[0]);
    expect(withRetry.params).toContain(retry.nonce);
    const without = sqlOf(outcomeQueries(db, saved())[0]);
    expect(without.params).not.toContain(retry.nonce);
  });
});
