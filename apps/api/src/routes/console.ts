import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { fromBase64, toBase64Url, utf8 } from '../encoding';
import type { AppEnv, Bindings } from '../env';
import { createTaskStore, type TaskRow, type TaskStore } from '../console/tasks-store';
import { bodyLimit } from '../middleware/security';
import { requireStaff } from '../middleware/staff';
import { parseBody, parseQuery } from '../validate';

const STATUSES = ['open', 'in_progress', 'done', 'dismissed'] as const;
const uuid = z.uuid();

const listQuery = z.object({
  status: z
    .string()
    .max(80)
    .optional()
    .transform((value) => (value ? value.split(',') : ['open', 'in_progress']))
    .pipe(z.array(z.enum(STATUSES)).min(1).max(4)),
  type: z
    .string()
    .regex(/^[a-zA-Z0-9_.-]{1,64}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
});

const noteBody = z.strictObject({ note: z.string().trim().max(500).optional() });
const newStaff = z.strictObject({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  name: z.string().trim().min(1).max(100),
  role: z.enum(['admin', 'operator']),
});
const patchStaff = z.strictObject({ disabled: z.boolean() });

const encodeCursor = (row: TaskRow) =>
  toBase64Url(utf8(JSON.stringify({ c: row.createdAt.toISOString(), i: row.id })));

function decodeCursor(value: string | undefined) {
  if (!value) return undefined;
  const bytes = fromBase64(value);
  try {
    const parsed = z
      .object({ c: z.iso.datetime(), i: uuid })
      .parse(JSON.parse(new TextDecoder().decode(bytes ?? new Uint8Array())));
    return { createdAt: new Date(parsed.c), id: parsed.i };
  } catch {
    throw new HTTPException(400, { message: 'Invalid cursor' });
  }
}

const taskView = (row: TaskRow) => ({
  id: row.id,
  clientId: row.clientId,
  clientName: row.clientName,
  orderId: row.orderId,
  type: row.type,
  title: row.title,
  payload: row.payload,
  status: row.status,
  assignedTo: row.assignedTo,
  resolvedAt: row.resolvedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});

export function createConsoleRoutes(options: {
  tasks?: ((env: Bindings) => TaskStore) | undefined;
  now: () => Date;
}) {
  const routes = new Hono<AppEnv>();
  routes.use(bodyLimit(4096));
  // Nothing under /console answers without a full session (email code + TOTP).
  routes.use(requireStaff());

  const tasksOf = (c: Context<AppEnv>) => options.tasks?.(c.env) ?? createTaskStore(c.var.getDb());

  const idParam = (c: Context<AppEnv>) => {
    const parsed = uuid.safeParse(c.req.param('id'));
    if (!parsed.success) throw new HTTPException(400, { message: 'Invalid id' });
    return parsed.data;
  };

  routes.get('/tasks', async (c) => {
    const q = await parseQuery(c, listQuery);
    const after = decodeCursor(q.cursor);
    const rows = await tasksOf(c).list({
      status: q.status,
      type: q.type,
      limit: q.limit + 1,
      after,
    });
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return c.json({
      tasks: page.map(taskView),
      nextCursor: rows.length > q.limit && last ? encodeCursor(last) : null,
    });
  });

  routes.get('/tasks/:id', async (c) => {
    const row = await tasksOf(c).get(idParam(c));
    if (!row) throw new HTTPException(404, { message: 'Task not found' });
    return c.json(taskView(row));
  });

  for (const action of ['claim', 'resolve', 'dismiss'] as const) {
    routes.post(`/tasks/:id/${action}`, async (c) => {
      const id = idParam(c);
      const raw = (await c.req.text()).trim();
      let body: unknown = {};
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          throw new HTTPException(400, { message: 'Invalid JSON body' });
        }
      }
      const { note } = noteBody.parse(body);
      const { staff } = c.var.staff;
      const store = tasksOf(c);
      const current = await store.get(id);
      if (!current) throw new HTTPException(404, { message: 'Task not found' });
      const updated = await store.transition({
        id,
        action,
        staffId: staff.id,
        isAdmin: staff.role === 'admin',
        note,
        now: options.now(),
      });
      if (!updated) {
        throw new HTTPException(409, { message: 'The task changed or belongs to someone else' });
      }
      return c.json(taskView(updated));
    });
  }

  // ---- Staff management: admins only --------------------------------------------------
  const admin = new Hono<AppEnv>();
  admin.use(requireStaff('admin'));

  admin.get('/', async (c) => {
    const people = await c.var.getAuth().store.listStaff();
    return c.json({
      staff: people.map((p) => ({
        id: p.id,
        email: p.email,
        name: p.name,
        role: p.role,
        totpEnrolled: p.totpEnrolledAt !== null,
        disabled: p.disabledAt !== null,
        createdAt: p.createdAt.toISOString(),
      })),
    });
  });

  admin.post('/', async (c) => {
    const body = await parseBody(c, newStaff);
    const deps = c.var.getAuth();
    const created = await deps.store.createStaff(body);
    if (!created) throw new HTTPException(409, { message: 'That email already exists' });
    await deps.audit({
      actorType: 'human',
      actorId: `staff:${c.var.staff.staff.id}`,
      action: 'staff.created',
      entityType: 'staff_user',
      entityId: created.id,
      after: { email: created.email, role: created.role },
    });
    return c.json(
      { id: created.id, email: created.email, name: created.name, role: created.role },
      201,
    );
  });

  admin.patch('/:id', async (c) => {
    const id = idParam(c);
    const { disabled } = await parseBody(c, patchStaff);
    const deps = c.var.getAuth();
    if (id === c.var.staff.staff.id) {
      throw new HTTPException(409, { message: 'You cannot disable yourself' });
    }
    const now = options.now();
    if (!(await deps.store.setDisabled(id, disabled ? now : null))) {
      throw new HTTPException(404, { message: 'Person not found' });
    }
    if (disabled) await deps.store.revokeStaffSessions(id, now);
    await deps.audit({
      actorType: 'human',
      actorId: `staff:${c.var.staff.staff.id}`,
      action: disabled ? 'staff.disabled' : 'staff.enabled',
      entityType: 'staff_user',
      entityId: id,
    });
    return c.json({ ok: true });
  });

  admin.post('/:id/reset-totp', async (c) => {
    const id = idParam(c);
    const deps = c.var.getAuth();
    if (!(await deps.store.findStaffById(id))) {
      throw new HTTPException(404, { message: 'Person not found' });
    }
    await deps.store.resetTotp(id, options.now());
    await deps.audit({
      actorType: 'human',
      actorId: `staff:${c.var.staff.staff.id}`,
      action: 'staff.totp_reset',
      entityType: 'staff_user',
      entityId: id,
    });
    return c.json({ ok: true });
  });

  routes.route('/staff', admin);
  return routes;
}
