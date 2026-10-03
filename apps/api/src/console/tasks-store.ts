import { clients, tasks, type Db } from '@fluvia/db';
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';

export type TaskStatus = 'open' | 'in_progress' | 'done' | 'dismissed';
export type TaskAction = 'claim' | 'resolve' | 'dismiss';

export type TaskRow = {
  id: string;
  clientId: string | null;
  clientName: string | null;
  orderId: string | null;
  type: string;
  title: string;
  payload: Record<string, unknown> | null;
  status: TaskStatus;
  assignedTo: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
};

export type TaskStore = {
  list(input: {
    status: TaskStatus[];
    type?: string | undefined;
    limit: number;
    /** Keyset cursor: the `createdAt`/`id` of the last row of the previous page. */
    after?: { createdAt: Date; id: string } | undefined;
  }): Promise<TaskRow[]>;
  get(id: string): Promise<TaskRow | null>;
  /**
   * Applies a transition and its audit_log row together, and only if the task is still in a
   * status the action may start from. Null means "no longer in that state" (409).
   */
  transition(input: {
    id: string;
    action: TaskAction;
    staffId: string;
    isAdmin: boolean;
    note?: string | undefined;
    now: Date;
  }): Promise<TaskRow | null>;
};

const columns = {
  id: tasks.id,
  clientId: tasks.clientId,
  clientName: clients.name,
  orderId: tasks.orderId,
  type: tasks.type,
  title: tasks.title,
  payload: tasks.payload,
  status: tasks.status,
  assignedTo: tasks.assignedTo,
  resolvedAt: tasks.resolvedAt,
  createdAt: tasks.createdAt,
};

const FROM_STATES: Record<TaskAction, TaskStatus[]> = {
  claim: ['open'],
  resolve: ['open', 'in_progress'],
  dismiss: ['open', 'in_progress'],
};

const TO_STATE: Record<TaskAction, TaskStatus> = {
  claim: 'in_progress',
  resolve: 'done',
  dismiss: 'dismissed',
};

export function transitionQuery(
  db: Db,
  input: { id: string; action: TaskAction; staffId: string; isAdmin: boolean; now: Date },
) {
  const actor = `staff:${input.staffId}`;
  // Someone else's claimed task can only be closed by an admin; claiming never steals.
  const notTaken = input.isAdmin
    ? undefined
    : or(sql`${tasks.assignedTo} is null`, eq(tasks.assignedTo, actor));
  return db
    .update(tasks)
    .set({
      status: TO_STATE[input.action],
      assignedTo: input.action === 'claim' ? actor : sql`coalesce(${tasks.assignedTo}, ${actor})`,
      resolvedAt: input.action === 'claim' ? null : input.now,
    })
    .where(and(eq(tasks.id, input.id), inArray(tasks.status, FROM_STATES[input.action]), notTaken))
    .returning({ id: tasks.id, clientId: tasks.clientId, status: tasks.status });
}

/**
 * Runs right after the update in the same batch (one transaction) and inserts the audit row
 * only if the update took effect: the row is recognised by the state the update leaves.
 */
export function transitionAuditQuery(
  db: Db,
  input: { id: string; action: TaskAction; staffId: string; note?: string | undefined; now: Date },
) {
  const actor = `staff:${input.staffId}`;
  const took =
    input.action === 'claim'
      ? sql`"t"."status" = 'in_progress' and "t"."assigned_to" = ${actor}`
      : sql`"t"."status" = ${TO_STATE[input.action]}::task_status and "t"."resolved_at" = ${input.now.toISOString()}::timestamptz`;
  const after = JSON.stringify(input.note ? { note: input.note } : {});
  return db.execute(sql`insert into "audit_log" ("actor_type", "actor_id", "action", "entity_type", "entity_id", "after")
    select 'human', ${actor}, ${`task.${input.action}`}, 'task', ${input.id}, ${after}::jsonb
    where exists (select 1 from "tasks" as "t" where "t"."id" = ${input.id}::uuid and ${took})`);
}

export function createTaskStore(db: Db): TaskStore {
  const select = () =>
    db.select(columns).from(tasks).leftJoin(clients, eq(clients.id, tasks.clientId));

  return {
    async list({ status, type, limit, after }) {
      return select()
        .where(
          and(
            inArray(tasks.status, status),
            type ? eq(tasks.type, type) : undefined,
            after
              ? or(
                  lt(tasks.createdAt, after.createdAt),
                  and(eq(tasks.createdAt, after.createdAt), lt(tasks.id, after.id)),
                )
              : undefined,
          ),
        )
        .orderBy(desc(tasks.createdAt), desc(tasks.id))
        .limit(limit);
    },

    async get(id) {
      const [row] = await select().where(eq(tasks.id, id)).limit(1);
      return row ?? null;
    },

    async transition(input) {
      const [updated] = await db.batch([
        transitionQuery(db, input),
        transitionAuditQuery(db, input),
      ]);
      return updated.length > 0 ? this.get(input.id) : null;
    },
  };
}
