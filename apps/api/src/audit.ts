import { auditLog, type Db } from '@fluvia/db';

export type AuditEntry = {
  actorType: 'ai' | 'human' | 'system';
  actorId?: string;
  action: string;
  clientId?: string;
  entityType?: string;
  entityId?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
};

/** Appends a row to audit_log and returns its id. Never put secrets in before/after. */
export async function writeAuditLog(db: Pick<Db, 'insert'>, entry: AuditEntry): Promise<string> {
  const [row] = await db
    .insert(auditLog)
    .values({
      actorType: entry.actorType,
      actorId: entry.actorId ?? null,
      action: entry.action,
      clientId: entry.clientId ?? null,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
    })
    .returning({ id: auditLog.id });
  if (!row) throw new Error('audit_log insert returned no row');
  return row.id;
}
