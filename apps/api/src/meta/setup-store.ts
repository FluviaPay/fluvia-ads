import { clients, metaConnections, tasks, type Db } from '@fluvia/db';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { auditInsert, type AuditEntry } from '../audit';
import type { MessageDestination } from './validate';
import type { SetupTaskCode, TaskDraft } from './task-catalog';

export type SetupContext = {
  client: { id: string; name: string; whatsapp: string };
  connection: {
    status: 'pending' | 'connected' | 'needs_action' | 'revoked';
    pageId: string | null;
    igId: string | null;
    adAccountId: string | null;
    pageAssignedAt: Date | null;
    messageDestinations: MessageDestination[];
    encryptedToken: string | null;
    tokenExpiresAt: Date | null;
  };
};

export type SetupStore = {
  getContext(clientId: string): Promise<SetupContext | null>;
  /** The account exists in Meta: remember it right away so a retry never creates a second one. */
  saveAdAccount(input: {
    clientId: string;
    adAccountId: string;
    igId: string | null;
  }): Promise<void>;
  markPageAssigned(input: {
    clientId: string;
    how: 'api' | 'acknowledged';
    now: Date;
  }): Promise<void>;
  /** status = connected, audit, and the team's open Meta tasks for this client are closed. */
  markConnected(input: {
    clientId: string;
    adAccountId: string;
    pageId: string;
    igId: string | null;
    destinations: MessageDestination[];
    now: Date;
  }): Promise<void>;
  /** status = needs_action, audit, and one task per code (no duplicate while one is open). */
  recordNeedsAction(input: {
    clientId: string;
    codes: SetupTaskCode[];
    tasks: TaskDraft[];
  }): Promise<void>;
  audit(entry: AuditEntry): Promise<void>;
};

type Queries = [BatchItem<'pg'>, ...BatchItem<'pg'>[]];

const system = { actorType: 'system', actorId: 'meta-setup' } as const;

export function contextQuery(db: Db, clientId: string) {
  return db
    .select({
      clientId: clients.id,
      clientName: clients.name,
      whatsapp: clients.whatsapp,
      status: metaConnections.status,
      pageId: metaConnections.pageId,
      igId: metaConnections.igId,
      adAccountId: metaConnections.adAccountId,
      pageAssignedAt: metaConnections.pageAssignedAt,
      messageDestinations: metaConnections.messageDestinations,
      encryptedToken: metaConnections.accessTokenEncrypted,
      tokenExpiresAt: metaConnections.tokenExpiresAt,
    })
    .from(metaConnections)
    .innerJoin(clients, eq(metaConnections.clientId, clients.id))
    .where(eq(metaConnections.clientId, clientId))
    .limit(1);
}

/**
 * ONE statement: inserts the task unless the client already has an open one of that type,
 * so re-running the setup (or a duplicated message) never piles up identical tasks.
 */
export function insertTaskIfNoOpenSql(clientId: string, draft: TaskDraft) {
  return sql`insert into "tasks" ("client_id", "type", "title", "payload")
    select ${clientId}::uuid, ${draft.type}, ${draft.title}, ${JSON.stringify(draft.payload)}::jsonb
    where not exists (
      select 1 from "tasks" as "t"
      where "t"."client_id" = ${clientId}::uuid
        and "t"."type" = ${draft.type}
        and "t"."status" in ('open', 'in_progress')
    )`;
}

/** Once the setup works, the team's open Meta tasks for the client are no longer needed. */
export function closeMetaTasksQuery(db: Db, clientId: string, now: Date) {
  return db
    .update(tasks)
    .set({ status: 'done', resolvedAt: now })
    .where(
      and(
        eq(tasks.clientId, clientId),
        like(tasks.type, 'meta.%'),
        inArray(tasks.status, ['open', 'in_progress']),
      ),
    );
}

export function markConnectedQueries(
  db: Db,
  input: Parameters<SetupStore['markConnected']>[0],
): Queries {
  return [
    db
      .update(metaConnections)
      .set({
        status: 'connected',
        adAccountId: input.adAccountId,
        pageId: input.pageId,
        igId: input.igId,
        messageDestinations: input.destinations,
      })
      .where(eq(metaConnections.clientId, input.clientId)),
    auditInsert(db, {
      ...system,
      action: 'meta.connected',
      clientId: input.clientId,
      after: {
        adAccountId: input.adAccountId,
        pageId: input.pageId,
        igId: input.igId,
        destinations: input.destinations,
      },
    }),
    closeMetaTasksQuery(db, input.clientId, input.now),
  ];
}

export function needsActionQueries(
  db: Db,
  input: Parameters<SetupStore['recordNeedsAction']>[0],
): Queries {
  return [
    db
      .update(metaConnections)
      .set({ status: 'needs_action' })
      .where(eq(metaConnections.clientId, input.clientId)),
    auditInsert(db, {
      ...system,
      action: 'meta.setup.needs_action',
      clientId: input.clientId,
      after: { codes: input.codes },
    }),
    ...input.tasks.map((draft) => db.execute(insertTaskIfNoOpenSql(input.clientId, draft))),
  ];
}

export function createSetupStore(db: Db): SetupStore {
  return {
    async getContext(clientId) {
      const [row] = await contextQuery(db, clientId);
      if (!row) return null;
      return {
        client: { id: row.clientId, name: row.clientName, whatsapp: row.whatsapp },
        connection: {
          status: row.status,
          pageId: row.pageId,
          igId: row.igId,
          adAccountId: row.adAccountId,
          pageAssignedAt: row.pageAssignedAt,
          messageDestinations: row.messageDestinations,
          encryptedToken: row.encryptedToken,
          tokenExpiresAt: row.tokenExpiresAt,
        },
      };
    },
    async saveAdAccount(input) {
      await db.batch([
        db
          .update(metaConnections)
          .set({ adAccountId: input.adAccountId, igId: input.igId })
          .where(eq(metaConnections.clientId, input.clientId)),
        auditInsert(db, {
          ...system,
          action: 'meta.setup.ad_account_saved',
          clientId: input.clientId,
          entityType: 'ad_account',
          entityId: input.adAccountId,
        }),
      ]);
    },
    async markPageAssigned(input) {
      await db.batch([
        db
          .update(metaConnections)
          .set({ pageAssignedAt: input.now })
          .where(eq(metaConnections.clientId, input.clientId)),
        auditInsert(db, {
          ...system,
          action: 'meta.setup.page_assigned',
          clientId: input.clientId,
          after: { how: input.how },
        }),
      ]);
    },
    async markConnected(input) {
      await db.batch(markConnectedQueries(db, input));
    },
    async recordNeedsAction(input) {
      await db.batch(needsActionQueries(db, input));
    },
    async audit(entry) {
      await auditInsert(db, entry);
    },
  };
}
