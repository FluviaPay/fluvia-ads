import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { expect, it } from 'vitest';
import * as s from './schema';

const tables: Record<string, PgTable> = {
  clients: s.clients,
  client_assets: s.clientAssets,
  meta_connections: s.metaConnections,
  orders: s.orders,
  payments: s.payments,
  funding: s.funding,
  campaigns: s.campaigns,
  creatives: s.creatives,
  metrics_daily: s.metricsDaily,
  tasks: s.tasks,
  ledger: s.ledger,
  audit_log: s.auditLog,
};

const columns = (t: PgTable) => getTableConfig(t).columns;
const col = (t: PgTable, name: string) => columns(t).find((c) => c.name === name);

it('defines the 12 tables with the expected names', () => {
  for (const [name, table] of Object.entries(tables)) {
    expect(getTableConfig(table).name).toBe(name);
  }
  expect(Object.keys(tables)).toHaveLength(12);
});

it('uses uuid ids and created_at on every table; updated_at except append-only ones', () => {
  for (const [name, table] of Object.entries(tables)) {
    expect(col(table, 'id')?.columnType).toBe('PgUUID');
    expect(col(table, 'created_at'), name).toBeDefined();
    const appendOnly = name === 'ledger' || name === 'audit_log';
    expect(col(table, 'updated_at') === undefined, name).toBe(appendOnly);
  }
});

it('stores COP amounts as bigint', () => {
  for (const [table, name] of [
    [s.orders, 'ad_budget_cop'],
    [s.orders, 'service_fee_cop'],
    [s.payments, 'amount_cop'],
    [s.funding, 'amount_cop'],
    [s.campaigns, 'daily_budget_cop'],
    [s.metricsDaily, 'spend_cop'],
    [s.ledger, 'amount_cop'],
  ] as const) {
    expect(col(table, name)?.getSQLType(), name).toBe('bigint');
  }
});

it('indexes every client_id and order_id foreign key', () => {
  for (const [name, table] of Object.entries(tables)) {
    const cfg = getTableConfig(table);
    const indexed = cfg.indexes.flatMap((i) =>
      i.config.columns.map((c) => ('name' in c ? c.name : '')),
    );
    const unique = [
      ...cfg.columns.filter((c) => c.isUnique).map((c) => c.name),
      ...cfg.uniqueConstraints.flatMap((u) => u.columns.map((c) => c.name)),
    ];
    for (const c of cfg.columns.filter((c) => c.name === 'client_id' || c.name === 'order_id')) {
      expect(indexed.includes(c.name) || unique.includes(c.name), `${name}.${c.name}`).toBe(true);
    }
  }
});

it('models message destinations, optional pixel and one connection per client', () => {
  expect(s.messageDestination.enumValues).toEqual(['whatsapp', 'instagram_direct', 'messenger']);
  expect(col(s.metaConnections, 'message_destinations')?.dataType).toBe('array');
  expect(col(s.metaConnections, 'pixel_id')?.notNull).toBe(false);
  expect(col(s.metaConnections, 'client_id')?.isUnique).toBe(true);
});

it('keeps kpi_agreed as jsonb and distinguishes ledger kinds', () => {
  expect(col(s.orders, 'kpi_agreed')?.getSQLType()).toBe('jsonb');
  expect(s.ledgerKind.enumValues).toEqual(['pauta', 'servicio']);
});

it('makes payment webhooks idempotent via a unique provider event id', () => {
  expect(col(s.payments, 'provider_event_id')?.isUnique).toBe(true);
});

it('stores the encrypted token and the single-use OAuth nonce on meta_connections, all nullable', () => {
  for (const name of [
    'access_token_encrypted',
    'token_expires_at',
    'oauth_nonce',
    'oauth_nonce_expires_at',
  ]) {
    const column = col(s.metaConnections, name);
    expect(column, name).toBeDefined();
    expect(column?.notNull, name).toBe(false);
  }
});

it('stores the encrypted token and the single-use OAuth nonce on meta_connections, all nullable', () => {
  for (const name of [
    'access_token_encrypted',
    'token_expires_at',
    'oauth_nonce',
    'oauth_nonce_expires_at',
  ]) {
    const column = col(s.metaConnections, name);
    expect(column, name).toBeDefined();
    expect(column?.notNull, name).toBe(false);
  }
});
