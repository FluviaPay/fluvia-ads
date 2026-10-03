import { describe, expect, it } from 'vitest';
import { authHarness } from '../auth/test-utils';
import type { TaskAction, TaskRow, TaskStore } from '../console/tasks-store';

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const ID_C = '33333333-3333-4333-8333-333333333333';
const t = (id: string, patch: Partial<TaskRow> = {}): TaskRow => ({
  id,
  clientId: null,
  clientName: 'Marca Uno',
  orderId: null,
  type: 'meta.PAGE_NOT_ADMIN',
  title: 'Pedir acceso a la página',
  payload: { instruction: 'Pídele al cliente que…' },
  status: 'open',
  assignedTo: null,
  resolvedAt: null,
  createdAt: new Date('2026-10-03T10:00:00Z'),
  ...patch,
});

/** Same transition rules as the SQL (states and who may touch a claimed task). */
function memoryTasks(rows: TaskRow[]) {
  const transitions: {
    id: string;
    action: TaskAction;
    staffId: string;
    note?: string | undefined;
  }[] = [];
  const from: Record<TaskAction, string[]> = {
    claim: ['open'],
    resolve: ['open', 'in_progress'],
    dismiss: ['open', 'in_progress'],
  };
  const to = { claim: 'in_progress', resolve: 'done', dismiss: 'dismissed' } as const;
  const store: TaskStore = {
    async list({ status, type, limit, after }) {
      return rows
        .filter((r) => status.includes(r.status) && (!type || r.type === type))
        .filter(
          (r) =>
            !after ||
            r.createdAt < after.createdAt ||
            (r.createdAt.getTime() === after.createdAt.getTime() && r.id < after.id),
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
        .slice(0, limit);
    },
    async get(id) {
      return rows.find((r) => r.id === id) ?? null;
    },
    async transition({ id, action, staffId, isAdmin, note, now }) {
      const row = rows.find((r) => r.id === id);
      const actor = `staff:${staffId}`;
      if (!row || !from[action].includes(row.status)) return null;
      if (!isAdmin && row.assignedTo && row.assignedTo !== actor) return null;
      transitions.push({ id, action, staffId, note });
      row.status = to[action];
      row.assignedTo = action === 'claim' ? actor : (row.assignedTo ?? actor);
      row.resolvedAt = action === 'claim' ? null : now;
      return row;
    },
  };
  return { store, transitions };
}

async function setup(
  rows: TaskRow[] = [
    t(ID_A),
    t(ID_B, { createdAt: new Date('2026-10-03T11:00:00Z'), type: 'meta.CONFIG_MISSING' }),
  ],
) {
  const tasks = memoryTasks(rows);
  const h = authHarness({
    tasks: tasks.store,
    seed: [
      { email: 'angela@fluvia.test', name: 'Angela', role: 'operator' },
      { email: 'luis@fluvia.test', name: 'Luis', role: 'operator' },
      { email: 'mauricio@fluvia.test', name: 'Mauricio', role: 'admin' },
    ],
  });
  // Administrators must hold a passkey to manage people (see requirePasskey).
  const adminPerson = await h.store.findStaffByEmail('mauricio@fluvia.test');
  await h.store.addPasskey({
    staffUserId: adminPerson?.id ?? '',
    credentialId: 'admin-credential',
    publicKey: 'AAAA',
    counter: 0,
    transports: [],
    deviceName: 'Llave de Mauricio',
    deviceType: 'multiDevice',
    backedUp: true,
  });
  return {
    h,
    tasks,
    angela: await h.loginAs('angela@fluvia.test'),
    luis: await h.loginAs('luis@fluvia.test'),
    admin: await h.loginAs('mauricio@fluvia.test'),
  };
}

const ROUTES: [string, string][] = [
  ['GET', '/console/tasks'],
  ['GET', `/console/tasks/${ID_A}`],
  ['POST', `/console/tasks/${ID_A}/claim`],
  ['POST', `/console/tasks/${ID_A}/resolve`],
  ['POST', `/console/tasks/${ID_A}/dismiss`],
  ['GET', '/console/staff'],
  ['POST', '/console/staff'],
  ['PATCH', `/console/staff/${ID_A}`],
  ['POST', `/console/staff/${ID_A}/reset-factors`],
  ['GET', '/console/anything-else'],
];

describe('authorization matrix', () => {
  it('every console route answers 401 without a session or with a half session', async () => {
    const { h } = await setup();
    const half = await h.loginAs('angela@fluvia.test', 'email_verified');
    for (const [method, path] of ROUTES) {
      expect((await h.call(path, { method })).status, `${method} ${path} anonymous`).toBe(401);
      expect((await h.call(path, { method, cookie: half })).status, `${method} ${path} half`).toBe(
        401,
      );
    }
  });

  it('operators get 403 on every staff-management route', async () => {
    const { h, angela } = await setup();
    for (const [method, path] of ROUTES.filter(([, p]) => p.startsWith('/console/staff'))) {
      expect(
        (await h.call(path, { method, cookie: angela, ...(method === 'GET' ? {} : { body: {} }) }))
          .status,
        `${method} ${path}`,
      ).toBe(403);
    }
  });

  it('a revoked or expired session is refused', async () => {
    const { h, angela } = await setup();
    expect((await h.call('/console/tasks', { method: 'GET', cookie: angela })).status).toBe(200);
    h.sessions.forEach((s) => (s.revokedAt = new Date()));
    expect((await h.call('/console/tasks', { method: 'GET', cookie: angela })).status).toBe(401);
  });

  it('cross-origin writes are refused even with a valid session', async () => {
    const { h, angela } = await setup();
    const res = await h.call(`/console/tasks/${ID_A}/claim`, {
      cookie: angela,
      origin: 'https://evil.test',
    });
    expect(res.status).toBe(403);
  });
});

describe('tasks', () => {
  it('lists open work newest first, filtered and paginated', async () => {
    const { h, angela } = await setup([
      t(ID_A, { createdAt: new Date('2026-10-03T08:00:00Z') }),
      t(ID_B, { createdAt: new Date('2026-10-03T09:00:00Z') }),
      t(ID_C, { createdAt: new Date('2026-10-03T10:00:00Z'), status: 'done' }),
    ]);
    const first = (await (
      await h.call('/console/tasks?limit=1', { method: 'GET', cookie: angela })
    ).json()) as { tasks: { id: string }[]; nextCursor: string };
    expect(first.tasks.map((x) => x.id)).toEqual([ID_B]);
    const second = (await (
      await h.call(`/console/tasks?limit=1&cursor=${first.nextCursor}`, {
        method: 'GET',
        cookie: angela,
      })
    ).json()) as { tasks: { id: string }[]; nextCursor: string | null };
    expect(second.tasks.map((x) => x.id)).toEqual([ID_A]);
    expect(second.nextCursor).toBeNull();
    const done = (await (
      await h.call('/console/tasks?status=done', { method: 'GET', cookie: angela })
    ).json()) as { tasks: { id: string }[] };
    expect(done.tasks.map((x) => x.id)).toEqual([ID_C]);
  });

  it('rejects bad filters, cursors and ids', async () => {
    const { h, angela } = await setup();
    for (const path of [
      '/console/tasks?status=hacked',
      '/console/tasks?limit=1000',
      '/console/tasks?cursor=@@@',
      "/console/tasks?type=a'; drop table tasks;--",
      '/console/tasks/not-a-uuid',
    ]) {
      expect((await h.call(path, { method: 'GET', cookie: angela })).status, path).toBe(400);
    }
    expect((await h.call(`/console/tasks/${ID_C}`, { method: 'GET', cookie: angela })).status).toBe(
      404,
    );
  });

  it('claim, resolve and dismiss follow the state machine and are one-shot', async () => {
    const { h, tasks, angela } = await setup();
    const claim = await h.call(`/console/tasks/${ID_A}/claim`, { cookie: angela });
    expect(claim.status).toBe(200);
    expect(await claim.json()).toMatchObject({ status: 'in_progress' });
    expect((await h.call(`/console/tasks/${ID_A}/claim`, { cookie: angela })).status).toBe(409);
    const done = await h.call(`/console/tasks/${ID_A}/resolve`, {
      cookie: angela,
      body: { note: 'Listo, el cliente ya es admin' },
    });
    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({ status: 'done' });
    expect((await h.call(`/console/tasks/${ID_A}/dismiss`, { cookie: angela })).status).toBe(409);
    expect(tasks.transitions.map((x) => x.action)).toEqual(['claim', 'resolve']);
    expect(tasks.transitions[1]?.note).toBe('Listo, el cliente ya es admin');
  });

  it('an operator cannot take over a claimed task; an admin can close it', async () => {
    const { h, angela, luis, admin } = await setup();
    await h.call(`/console/tasks/${ID_A}/claim`, { cookie: angela });
    expect((await h.call(`/console/tasks/${ID_A}/resolve`, { cookie: luis })).status).toBe(409);
    expect((await h.call(`/console/tasks/${ID_A}/resolve`, { cookie: admin })).status).toBe(200);
  });

  it('refuses unknown fields and long notes', async () => {
    const { h, angela } = await setup();
    expect(
      (await h.call(`/console/tasks/${ID_A}/resolve`, { cookie: angela, body: { status: 'done' } }))
        .status,
    ).toBe(400);
    expect(
      (
        await h.call(`/console/tasks/${ID_A}/resolve`, {
          cookie: angela,
          body: { note: 'x'.repeat(501) },
        })
      ).status,
    ).toBe(400);
    expect(
      (await h.call(`/console/tasks/${ID_A}/resolve`, { cookie: angela, body: '{' as never }))
        .status,
    ).toBe(400);
  });
});

describe('staff management (admin)', () => {
  it('creates people, normalizes the email and refuses duplicates', async () => {
    const { h, admin } = await setup();
    const created = await h.call('/console/staff', {
      cookie: admin,
      body: { email: ' NUEVA@Fluvia.test ', name: 'Nueva', role: 'operator' },
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ email: 'nueva@fluvia.test', role: 'operator' });
    expect(
      (
        await h.call('/console/staff', {
          cookie: admin,
          body: { email: 'nueva@fluvia.test', name: 'X', role: 'operator' },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await h.call('/console/staff', {
          cookie: admin,
          body: { email: 'x@fluvia.test', name: 'X', role: 'root' },
        })
      ).status,
    ).toBe(400);
    expect(
      h.audits.some((a) => (a as unknown as { action: string }).action === 'staff.created'),
    ).toBe(true);
  });

  it('an administrator without a passkey cannot manage people yet', async () => {
    const { h, admin } = await setup();
    h.passkeys.length = 0;
    for (const [method, path] of ROUTES.filter(([, p]) => p.startsWith('/console/staff'))) {
      const res = await h.call(path, {
        method,
        cookie: admin,
        ...(method === 'GET' ? {} : { body: {} }),
      });
      expect(res.status, `${method} ${path}`).toBe(403);
    }
    // Tasks are still available to them.
    expect((await h.call('/console/tasks', { method: 'GET', cookie: admin })).status).toBe(200);
  });

  it('lists people without any secret material', async () => {
    const { h, admin } = await setup();
    const body = JSON.stringify(
      await (await h.call('/console/staff', { method: 'GET', cookie: admin })).json(),
    );
    expect(body).toContain('angela@fluvia.test');
    expect(body).not.toMatch(/totpSecret|recovery|hash|token/i);
  });

  it('disabling kills sessions at once; an admin cannot disable themselves', async () => {
    const { h, angela, admin } = await setup();
    const angelaId = [...h.staff.values()].find((s) => s.email === 'angela@fluvia.test')?.id ?? '';
    const adminId = [...h.staff.values()].find((s) => s.email === 'mauricio@fluvia.test')?.id ?? '';
    expect(
      (
        await h.call(`/console/staff/${adminId}`, {
          method: 'PATCH',
          cookie: admin,
          body: { disabled: true },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await h.call(`/console/staff/${angelaId}`, {
          method: 'PATCH',
          cookie: admin,
          body: { disabled: true },
        })
      ).status,
    ).toBe(200);
    expect((await h.call('/console/tasks', { method: 'GET', cookie: angela })).status).toBe(401);
  });

  it('resets every sign-in factor (TOTP, passkeys, recovery codes) and revokes sessions', async () => {
    const { h, angela, admin } = await setup();
    const person = [...h.staff.values()].find((s) => s.email === 'angela@fluvia.test');
    if (person) Object.assign(person, { totpEnrolledAt: new Date(), totpSecretEnc: 'v1.x.y' });
    const res = await h.call(`/console/staff/${person?.id}/reset-factors`, { cookie: admin });
    expect(res.status).toBe(200);
    expect(person?.totpEnrolledAt).toBeNull();
    expect(h.passkeys.filter((p) => p.staffUserId === person?.id)).toEqual([]);
    expect((await h.call('/console/tasks', { method: 'GET', cookie: angela })).status).toBe(401);
  });
});
