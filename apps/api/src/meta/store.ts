import type { ConnectReason } from '@fluvia/shared';
import { clients, metaConnections, tasks, type Db } from '@fluvia/db';
import { and, eq, gt } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { auditInsert } from '../audit';

/** A fresh single-use nonce so the client can try again after a non-ok result. */
export type RetryLink = { nonce: string; expiresAt: Date };

export type ConnectionOutcome =
  | {
      kind: 'saved';
      clientId: string;
      status: 'pending' | 'needs_action';
      pageId: string | null;
      igId: string | null;
      permissions: string[];
      reasons: ConnectReason[];
      /** Already encrypted; the store never sees the plaintext token. */
      encryptedToken: string;
      tokenExpiresAt: Date | null;
      retry: RetryLink | null;
    }
  | { kind: 'cancelled'; clientId: string; retry: RetryLink }
  | { kind: 'failed'; clientId: string; reason: string; retry: RetryLink }
  | { kind: 'rejected'; clientId: string; reason: 'reused_or_expired' };

export type ConnectionStore = {
  clientExists(clientId: string): Promise<boolean>;
  /** Creates (or refreshes) the client's pending connection with a new nonce. */
  createLink(input: { clientId: string; nonce: string; expiresAt: Date }): Promise<void>;
  /** Atomic and single-use: true only for the first caller with a valid, unexpired nonce. */
  consumeNonce(input: { clientId: string; nonce: string; now: Date }): Promise<boolean>;
  /** Applies the outcome and its audit_log (and tasks) rows in ONE transaction. */
  recordOutcome(outcome: ConnectionOutcome): Promise<void>;
};

type Queries = [BatchItem<'pg'>, ...BatchItem<'pg'>[]];

const retryColumns = (retry: RetryLink | null) => ({
  oauthNonce: retry?.nonce ?? null,
  oauthNonceExpiresAt: retry?.expiresAt ?? null,
});

const human = (clientId: string) =>
  ({ actorType: 'human', actorId: `client:${clientId}` }) as const;
const system = (actorId: string) => ({ actorType: 'system', actorId }) as const;

export function createLinkQueries(
  db: Db,
  input: { clientId: string; nonce: string; expiresAt: Date },
): Queries {
  const nonce = { oauthNonce: input.nonce, oauthNonceExpiresAt: input.expiresAt };
  return [
    db
      .insert(metaConnections)
      .values({ clientId: input.clientId, ...nonce })
      .onConflictDoUpdate({ target: metaConnections.clientId, set: nonce }),
    auditInsert(db, {
      ...system('internal-api'),
      action: 'meta.connection.link_created',
      clientId: input.clientId,
      after: { expiresAt: input.expiresAt.toISOString() },
    }),
  ];
}

/** One statement: matches the nonce AND its expiry and clears it, so it can only win once. */
export function consumeNonceQuery(db: Db, input: { clientId: string; nonce: string; now: Date }) {
  return db
    .update(metaConnections)
    .set({ oauthNonce: null, oauthNonceExpiresAt: null })
    .where(
      and(
        eq(metaConnections.clientId, input.clientId),
        eq(metaConnections.oauthNonce, input.nonce),
        gt(metaConnections.oauthNonceExpiresAt, input.now),
      ),
    )
    .returning({ id: metaConnections.id });
}

/** Audit rows never include the token, encrypted or not. */
export function outcomeQueries(db: Db, outcome: ConnectionOutcome): Queries {
  const where = eq(metaConnections.clientId, outcome.clientId);

  switch (outcome.kind) {
    case 'saved': {
      const queries: Queries = [
        db
          .update(metaConnections)
          .set({
            pageId: outcome.pageId,
            igId: outcome.igId,
            permissions: outcome.permissions,
            status: outcome.status,
            accessTokenEncrypted: outcome.encryptedToken,
            tokenExpiresAt: outcome.tokenExpiresAt,
            ...retryColumns(outcome.retry),
          })
          .where(where),
        auditInsert(db, {
          ...human(outcome.clientId),
          action:
            outcome.status === 'pending' ? 'meta.connection.saved' : 'meta.connection.needs_action',
          clientId: outcome.clientId,
          after: {
            status: outcome.status,
            pageId: outcome.pageId,
            igId: outcome.igId,
            permissions: outcome.permissions,
            reasons: outcome.reasons,
          },
        }),
      ];
      if (outcome.status === 'needs_action') {
        queries.push(
          db.insert(tasks).values({
            clientId: outcome.clientId,
            type: 'meta.connection.needs_action',
            title: 'La conexión con Meta del cliente necesita ajustes',
            payload: { reasons: outcome.reasons },
          }),
        );
      }
      return queries;
    }
    case 'cancelled':
      // The client's own decision: audited, but no task for the team.
      return [
        db.update(metaConnections).set(retryColumns(outcome.retry)).where(where),
        auditInsert(db, {
          ...human(outcome.clientId),
          action: 'meta.connection.cancelled',
          clientId: outcome.clientId,
        }),
      ];
    case 'failed':
      return [
        db.update(metaConnections).set(retryColumns(outcome.retry)).where(where),
        auditInsert(db, {
          ...system('oauth-callback'),
          action: 'meta.connection.failed',
          clientId: outcome.clientId,
          after: { reason: outcome.reason },
        }),
        db.insert(tasks).values({
          clientId: outcome.clientId,
          type: 'meta.connection.failed',
          title: 'Falló la conexión con Meta de un cliente',
          payload: { reason: outcome.reason },
        }),
      ];
    case 'rejected':
      return [
        auditInsert(db, {
          ...system('oauth-callback'),
          action: 'meta.connection.state_rejected',
          clientId: outcome.clientId,
          after: { reason: outcome.reason },
        }),
      ];
  }
}

export function createConnectionStore(db: Db): ConnectionStore {
  return {
    async clientExists(clientId) {
      const rows = await db
        .select({ id: clients.id })
        .from(clients)
        .where(eq(clients.id, clientId))
        .limit(1);
      return rows.length > 0;
    },
    async createLink(input) {
      await db.batch(createLinkQueries(db, input));
    },
    async consumeNonce(input) {
      const rows = await consumeNonceQuery(db, input);
      return rows.length > 0;
    },
    async recordOutcome(outcome) {
      await db.batch(outcomeQueries(db, outcome));
    },
  };
}
