import { createDb } from '@fluvia/db';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  closeMetaTasksQuery,
  contextQuery,
  insertTaskIfNoOpenSql,
  markConnectedQueries,
  needsActionQueries,
} from './setup-store';
import { buildTask } from './task-catalog';

const db = createDb('postgres://user:pass@localhost/db');
const CLIENT = '0b6f6f9e-1c1a-4d5e-9a57-2f2f7b1b0a11';
const NOW = new Date('2026-10-02T12:00:00Z');
const toSql = (q: unknown) => (q as { toSQL(): { sql: string; params: unknown[] } }).toSQL();
const raw = (q: Parameters<PgDialect['sqlToQuery']>[0]) => new PgDialect().sqlToQuery(q);

describe('insertTaskIfNoOpenSql', () => {
  const draft = buildTask('IG_NOT_PROFESSIONAL', { clientId: CLIENT, clientName: 'Luna' });
  const { sql, params } = raw(insertTaskIfNoOpenSql(CLIENT, draft));

  it('is ONE statement: insert ... select ... where not exists (an open task of that type)', () => {
    expect(sql).toMatch(/^insert into "tasks"/);
    expect(sql).toContain('where not exists');
    expect(sql).toContain(`"t"."status" in ('open', 'in_progress')`);
    expect(sql.match(/\binsert\b/g)).toHaveLength(1);
  });

  it('binds client, type, title and payload instead of inlining them', () => {
    expect(params).toEqual(
      expect.arrayContaining([
        CLIENT,
        'meta.setup.IG_NOT_PROFESSIONAL',
        draft.title,
        JSON.stringify(draft.payload),
      ]),
    );
    expect(sql).not.toContain('Luna');
    expect(sql).not.toContain('IG_NOT_PROFESSIONAL');
  });
});

describe('queries', () => {
  it('reads the connection and the client in one join', () => {
    const { sql } = toSql(contextQuery(db, CLIENT));
    expect(sql).toContain('from "meta_connections" inner join "clients"');
    expect(sql).toContain('"access_token_encrypted"');
    expect(sql).toContain('"page_assigned_at"');
  });

  it('closes only the open Meta tasks of that client', () => {
    const { sql, params } = toSql(closeMetaTasksQuery(db, CLIENT, NOW));
    expect(sql).toMatch(/^update "tasks" set "status" = \$1, "resolved_at" = \$2/);
    expect(sql).toContain('"client_id" = $');
    expect(sql).toContain('"type" like $');
    expect(sql).toContain('"status" in ($');
    expect(params).toEqual(
      expect.arrayContaining(['done', CLIENT, 'meta.%', 'open', 'in_progress']),
    );
  });

  it('markConnected: update + audit + close tasks, in one batch', () => {
    const queries = markConnectedQueries(db, {
      clientId: CLIENT,
      adAccountId: 'act_1',
      pageId: '100',
      igId: null,
      destinations: ['whatsapp'],
      now: NOW,
    }).map(toSql);
    expect(queries.map((q) => q.sql.split(' ').slice(0, 3).join(' '))).toEqual([
      'update "meta_connections" set',
      'insert into "audit_log"',
      'update "tasks" set',
    ]);
    expect(queries[0]?.params).toEqual(expect.arrayContaining(['connected', 'act_1', '100']));
    expect(queries[1]?.params).toContain('meta.connected');
  });

  it('needsAction: status + audit + one guarded insert per task', () => {
    const tasks = [
      buildTask('WA_NOT_LINKED', { clientId: CLIENT }),
      buildTask('IG_NOT_PROFESSIONAL', { clientId: CLIENT }),
    ];
    const queries = needsActionQueries(db, {
      clientId: CLIENT,
      codes: ['WA_NOT_LINKED', 'IG_NOT_PROFESSIONAL'],
      tasks,
    });
    expect(queries).toHaveLength(4);
    const first = toSql(queries[0]);
    expect(first.sql).toMatch(/^update "meta_connections" set "status" = \$1/);
    expect(first.params).toContain('needs_action');
    expect(toSql(queries[1]).params).toContain('meta.setup.needs_action');
  });
});
