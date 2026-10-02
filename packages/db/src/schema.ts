import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { cop, createdAt, id, timestamps } from './columns';
import {
  actorType,
  approvalStatus,
  assetType,
  campaignObjective,
  campaignStatus,
  clientStatus,
  creativeFormat,
  fundingStatus,
  ledgerDirection,
  ledgerKind,
  messageDestination,
  metaConnectionStatus,
  orderStatus,
  paymentMethod,
  paymentStatus,
  taskStatus,
} from './enums';

export * from './enums';

const clientRef = () =>
  uuid('client_id')
    .notNull()
    .references(() => clients.id);
const orderRef = () =>
  uuid('order_id')
    .notNull()
    .references(() => orders.id);

export const clients = pgTable('clients', {
  id: id(),
  name: text('name').notNull(),
  contactName: text('contact_name').notNull(),
  email: text('email'),
  whatsapp: text('whatsapp').notNull(),
  websiteUrl: text('website_url'),
  category: text('category').notNull(),
  status: clientStatus('status').notNull().default('lead'),
  ...timestamps(),
});

export const clientAssets = pgTable(
  'client_assets',
  {
    id: id(),
    clientId: clientRef(),
    type: assetType('type').notNull(),
    r2Key: text('r2_key').notNull(),
    mimeType: text('mime_type').notNull(),
    ...timestamps(),
  },
  (t) => [index('client_assets_client_id_idx').on(t.clientId)],
);

export const metaConnections = pgTable('meta_connections', {
  id: id(),
  clientId: clientRef().unique(),
  pageId: text('page_id'),
  igId: text('ig_id'),
  adAccountId: text('ad_account_id').unique(),
  messageDestinations: messageDestination('message_destinations')
    .array()
    .notNull()
    .default(sql`'{}'`),
  pixelId: text('pixel_id'),
  permissions: jsonb('permissions').$type<string[]>().notNull().default([]),
  status: metaConnectionStatus('status').notNull().default('pending'),
  ...timestamps(),
});

export const orders = pgTable(
  'orders',
  {
    id: id(),
    clientId: clientRef(),
    objective: campaignObjective('objective').notNull(),
    adBudgetCop: cop('ad_budget_cop').notNull(),
    serviceFeeCop: cop('service_fee_cop').notNull(),
    durationDays: integer('duration_days').notNull(),
    kpiAgreed: jsonb('kpi_agreed').$type<Record<string, unknown>>().notNull(),
    status: orderStatus('status').notNull().default('draft'),
    ...timestamps(),
  },
  (t) => [
    index('orders_client_id_idx').on(t.clientId),
    check('orders_amounts_nonneg', sql`${t.adBudgetCop} >= 0 AND ${t.serviceFeeCop} >= 0`),
    check('orders_duration_positive', sql`${t.durationDays} > 0`),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: id(),
    clientId: clientRef(),
    orderId: orderRef(),
    amountCop: cop('amount_cop').notNull(),
    method: paymentMethod('method'),
    status: paymentStatus('status').notNull().default('pending'),
    providerPaymentId: text('provider_payment_id'),
    /** Idempotency key: external (Coloca) event id of the confirming webhook. */
    providerEventId: text('provider_event_id').unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    index('payments_client_id_idx').on(t.clientId),
    index('payments_order_id_idx').on(t.orderId),
    check('payments_amount_nonneg', sql`${t.amountCop} >= 0`),
  ],
);

export const funding = pgTable(
  'funding',
  {
    id: id(),
    clientId: clientRef(),
    orderId: orderRef(),
    amountCop: cop('amount_cop').notNull(),
    status: fundingStatus('status').notNull().default('pending'),
    metaReference: text('meta_reference'),
    ...timestamps(),
  },
  (t) => [
    index('funding_client_id_idx').on(t.clientId),
    index('funding_order_id_idx').on(t.orderId),
    check('funding_amount_nonneg', sql`${t.amountCop} >= 0`),
  ],
);

export const campaigns = pgTable(
  'campaigns',
  {
    id: id(),
    clientId: clientRef(),
    orderId: orderRef(),
    /** Generated name: FLV_{clientId}_{categoria}_{objetivo}_{yyyymmdd}. */
    name: text('name').notNull(),
    objective: campaignObjective('objective').notNull(),
    metaCampaignId: text('meta_campaign_id'),
    dailyBudgetCop: cop('daily_budget_cop').notNull(),
    status: campaignStatus('status').notNull().default('draft'),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    index('campaigns_client_id_idx').on(t.clientId),
    index('campaigns_order_id_idx').on(t.orderId),
    check('campaigns_budget_nonneg', sql`${t.dailyBudgetCop} >= 0`),
  ],
);

export const creatives = pgTable(
  'creatives',
  {
    id: id(),
    clientId: clientRef(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    assetId: uuid('asset_id').references(() => clientAssets.id),
    format: creativeFormat('format').notNull(),
    headline: text('headline'),
    body: text('body').notNull(),
    cta: text('cta'),
    metaAdId: text('meta_ad_id'),
    policyCheck: jsonb('policy_check').$type<Record<string, unknown>>(),
    approvalStatus: approvalStatus('approval_status').notNull().default('pending'),
    approvedBy: text('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    index('creatives_client_id_idx').on(t.clientId),
    index('creatives_campaign_id_idx').on(t.campaignId),
  ],
);

export const metricsDaily = pgTable(
  'metrics_daily',
  {
    id: id(),
    clientId: clientRef(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    date: date('date', { mode: 'string' }).notNull(),
    spendCop: cop('spend_cop').notNull().default(0),
    impressions: integer('impressions').notNull().default(0),
    clicks: integer('clicks').notNull().default(0),
    messages: integer('messages').notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    unique('metrics_daily_campaign_date_uq').on(t.campaignId, t.date),
    index('metrics_daily_client_id_idx').on(t.clientId),
    check('metrics_daily_spend_nonneg', sql`${t.spendCop} >= 0`),
  ],
);

export const tasks = pgTable(
  'tasks',
  {
    id: id(),
    clientId: uuid('client_id').references(() => clients.id),
    orderId: uuid('order_id').references(() => orders.id),
    type: text('type').notNull(),
    title: text('title').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    status: taskStatus('status').notNull().default('open'),
    assignedTo: text('assigned_to'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    index('tasks_client_id_idx').on(t.clientId),
    index('tasks_order_id_idx').on(t.orderId),
    index('tasks_status_idx').on(t.status),
  ],
);

/** Append-only: no updated_at. */
export const ledger = pgTable(
  'ledger',
  {
    id: id(),
    clientId: clientRef(),
    orderId: orderRef(),
    paymentId: uuid('payment_id').references(() => payments.id),
    kind: ledgerKind('kind').notNull(),
    direction: ledgerDirection('direction').notNull(),
    amountCop: cop('amount_cop').notNull(),
    description: text('description'),
    createdAt: createdAt(),
  },
  (t) => [
    index('ledger_client_id_idx').on(t.clientId),
    index('ledger_order_id_idx').on(t.orderId),
    index('ledger_payment_id_idx').on(t.paymentId),
    check('ledger_amount_positive', sql`${t.amountCop} > 0`),
  ],
);

/** Append-only: no updated_at. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    clientId: uuid('client_id').references(() => clients.id),
    actorType: actorType('actor_type').notNull(),
    actorId: text('actor_id'),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    before: jsonb('before').$type<Record<string, unknown>>(),
    after: jsonb('after').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_log_client_id_idx').on(t.clientId),
    index('audit_log_entity_idx').on(t.entityType, t.entityId),
  ],
);
