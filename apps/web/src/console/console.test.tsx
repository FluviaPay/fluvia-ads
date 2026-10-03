import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { cspPlugin } from '../../vite.config';
import { resolveRoute } from '../route';
import { ApiError, createConsoleApi, type Me, type Task } from './api';
import { Console, Devices, StepForm, TaskDetail, TaskList } from './Console';
import {
  errorText,
  formatSecret,
  passkeysSupported,
  payloadLines,
  suggestDeviceName,
} from './text';

const task = (patch: Partial<Task> = {}): Task => ({
  id: '11111111-1111-4111-8111-111111111111',
  clientId: null,
  clientName: 'Marca Uno',
  type: 'meta.PAGE_NOT_ADMIN',
  title: 'Pedir acceso a la página',
  payload: { instruction: 'Pídele al cliente que te dé acceso.', pageId: '123' },
  status: 'open',
  assignedTo: null,
  resolvedAt: null,
  createdAt: '2026-10-03T10:00:00Z',
  ...patch,
});
const me: Me = {
  id: 'u1',
  email: 'a@fluvia.test',
  name: 'Angela',
  role: 'operator',
  hasPasskey: false,
};

describe('console api client', () => {
  const okJson = (body: unknown) => vi.fn(async () => Response.json(body));

  it('sends the cookie and the CSRF header on writes, not on reads', async () => {
    const fetchFn = okJson({ ok: true });
    const api = createConsoleApi('https://api.fluvia.test/', fetchFn as unknown as typeof fetch);
    await api.requestCode('a@fluvia.test');
    await api.me();
    const [write, read] = fetchFn.mock.calls as unknown as [string, RequestInit][];
    expect(write?.[0]).toBe('https://api.fluvia.test/auth/login');
    expect(write?.[1]?.credentials).toBe('include');
    expect((write?.[1]?.headers as Record<string, string>)['x-fluvia-csrf']).toBe('1');
    expect(read?.[1]?.method).toBe('GET');
    expect((read?.[1]?.headers as Record<string, string>)['x-fluvia-csrf']).toBeUndefined();
  });

  it('encodes ids and filters, and sends the note only when there is one', async () => {
    const fetchFn = okJson({ tasks: [], nextCursor: null });
    const api = createConsoleApi('https://api.fluvia.test', fetchFn as unknown as typeof fetch);
    await api.listTasks({ status: ['open', 'in_progress'], cursor: 'abc' });
    await api.taskAction('x/../y', 'resolve');
    await api.taskAction('z', 'claim', 'nota');
    const calls = fetchFn.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0]?.[0]).toBe(
      'https://api.fluvia.test/console/tasks?status=open%2Cin_progress&cursor=abc',
    );
    expect(calls[1]?.[0]).toBe('https://api.fluvia.test/console/tasks/x%2F..%2Fy/resolve');
    expect(calls[1]?.[1]?.body).toBe('{}');
    expect(calls[2]?.[1]?.body).toBe('{"note":"nota"}');
  });

  it('turns HTTP errors into ApiError with the status', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 401 }));
    const api = createConsoleApi('https://api.fluvia.test', fetchFn as unknown as typeof fetch);
    await expect(api.me()).rejects.toMatchObject({ status: 401 });
  });
});

describe('texts and helpers', () => {
  it('maps errors to Spanish messages that never echo server details', () => {
    expect(errorText(new ApiError(401, 'x'))).toMatch(/código/);
    expect(errorText(new ApiError(429, 'x'))).toMatch(/intentos/);
    expect(errorText(new ApiError(409, 'x'))).toMatch(/Actualiza/);
    expect(errorText(new Error('boom: stack trace'))).not.toMatch(/boom/);
  });

  it('groups the secret and shows only plain payload values, instruction first', () => {
    expect(formatSecret('ABCDEFGHIJKL')).toBe('ABCD EFGH IJKL');
    const lines = payloadLines({
      pageId: '1',
      nested: { a: 1 },
      list: [1],
      instruction: 'Haz esto',
      ok: true,
    });
    expect(lines.map((l) => l.label)).toEqual(['instruction', 'pageId', 'ok']);
  });
});

describe('rendering', () => {
  it('starts on the loading view and routes /console', () => {
    expect(renderToStaticMarkup(<Console apiBaseUrl="https://api.fluvia.test" />)).toContain(
      'Cargando',
    );
    expect(resolveRoute('/console', '')).toEqual({ name: 'console' });
    expect(resolveRoute('/console/', '')).toEqual({ name: 'console' });
  });

  it('renders the email step as a required email field', () => {
    const html = renderToStaticMarkup(
      <StepForm
        title="Ingreso"
        label="Correo"
        type="email"
        button="Enviar"
        error={null}
        busy={false}
        onSubmit={() => {}}
      />,
    );
    expect(html).toContain('type="email"');
    expect(html).toContain('required');
  });

  it('escapes task text instead of interpreting it as HTML', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const html = renderToStaticMarkup(
      <>
        <TaskList
          tasks={[task({ title: evil, clientName: evil })]}
          selectedId={null}
          onSelect={() => {}}
        />
        <TaskDetail
          task={task({ title: evil, payload: { instruction: evil } })}
          me={me}
          busy={false}
          onAction={() => {}}
        />
      </>,
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('offers the right buttons per state and role', () => {
    const open = renderToStaticMarkup(
      <TaskDetail task={task()} me={me} busy={false} onAction={() => {}} />,
    );
    expect(open).toContain('Tomar');
    const done = renderToStaticMarkup(
      <TaskDetail task={task({ status: 'done' })} me={me} busy={false} onAction={() => {}} />,
    );
    expect(done).not.toContain('Resolver');
    const other = task({ status: 'in_progress', assignedTo: 'staff:someone-else' });
    const blocked = renderToStaticMarkup(
      <TaskDetail task={other} me={me} busy={false} onAction={() => {}} />,
    );
    expect(blocked).toContain('Otra persona tiene esta tarea');
    expect(blocked).toMatch(/disabled=""[^>]*>Resolver/);
    const admin = renderToStaticMarkup(
      <TaskDetail task={other} me={{ ...me, role: 'admin' }} busy={false} onAction={() => {}} />,
    );
    expect(admin).not.toContain('Otra persona');
  });
});

describe('content security policy', () => {
  it('allows scripts only from self and connections only to the API', () => {
    const plugin = cspPlugin('https://api.fluvia.test/some/path');
    const transform = plugin.transformIndexHtml as unknown as () => {
      attrs: { content: string };
    }[];
    const policy = transform()[0]?.attrs.content ?? '';
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("connect-src 'self' https://api.fluvia.test");
    expect(policy).toContain("object-src 'none'");
    expect(policy).not.toContain('unsafe-inline');
    expect(policy).not.toContain('unsafe-eval');
  });
});

describe('passkeys', () => {
  it('calls the passkey endpoints with the cookie and the CSRF header', async () => {
    const fetchFn = vi.fn(async () => Response.json({ ok: true, passkeys: [] }));
    const api = createConsoleApi('https://api.fluvia.test', fetchFn as unknown as typeof fetch);
    await api.passkeyLoginOptions();
    await api.passkeyLoginVerify('c1', { id: 'a' } as never);
    await api.passkeyRegisterOptions();
    await api.passkeyRegisterVerify('c2', 'Mi Mac', { id: 'b' } as never);
    await api.listPasskeys();
    await api.deletePasskey('x/y');
    const calls = fetchFn.mock.calls as unknown as [string, RequestInit][];
    expect(
      calls.map(([url, init]) => `${init.method} ${url.replace('https://api.fluvia.test', '')}`),
    ).toEqual([
      'POST /auth/passkey/login/options',
      'POST /auth/passkey/login/verify',
      'POST /auth/passkey/register/options',
      'POST /auth/passkey/register/verify',
      'GET /auth/passkeys',
      'DELETE /auth/passkeys/x%2Fy',
    ]);
    for (const [, init] of calls) {
      expect(init.credentials).toBe('include');
      const headers = init.headers as Record<string, string>;
      expect(headers['x-fluvia-csrf']).toBe(init.method === 'GET' ? undefined : '1');
    }
    expect(JSON.parse(String(calls[3]?.[1].body))).toMatchObject({
      challengeId: 'c2',
      deviceName: 'Mi Mac',
    });
  });

  it('explains a cancelled prompt and a duplicate device in Spanish', () => {
    const cancelled = Object.assign(new Error('x'), { name: 'NotAllowedError' });
    const duplicate = Object.assign(new Error('x'), { name: 'InvalidStateError' });
    expect(errorText(cancelled)).toMatch(/Cancelaste/);
    expect(errorText(duplicate)).toMatch(/ya está registrado/);
    expect(errorText(new ApiError(403, 'x'))).toMatch(/passkey/);
  });

  it('suggests a device name from the user agent and detects missing support on the server', () => {
    expect(suggestDeviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('Mac');
    expect(suggestDeviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Windows');
    expect(suggestDeviceName('Mozilla/5.0 (Linux; Android 14)')).toBe('Android');
    expect(suggestDeviceName('')).toBe('Mi dispositivo');
    expect(passkeysSupported()).toBe(false); // no window while rendering on the server
  });

  it('lists devices without key material and escapes their names', () => {
    const passkey = {
      id: 'p1',
      deviceName: '<img src=x onerror=alert(1)>',
      deviceType: 'multiDevice',
      backedUp: true,
      createdAt: '2026-10-03T10:00:00Z',
      lastUsedAt: null,
    };
    const html = renderToStaticMarkup(
      <Devices
        passkeys={[passkey]}
        busy={false}
        supported={true}
        onAdd={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(html).toContain('Sincronizada');
    expect(html).toContain('Agregar passkey');
    const unsupported = renderToStaticMarkup(
      <Devices passkeys={[]} busy={false} supported={false} onAdd={() => {}} onRemove={() => {}} />,
    );
    expect(unsupported).toContain('no admite passkeys');
    expect(unsupported).not.toContain('Agregar passkey');
  });
});
