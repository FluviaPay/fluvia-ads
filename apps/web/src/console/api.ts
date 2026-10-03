import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';

export type Role = 'admin' | 'operator';
export type Me = { id: string; email: string; name: string; role: Role; hasPasskey: boolean };
export type Methods = { totp: boolean; passkey: boolean };
export type Passkey = {
  id: string;
  deviceName: string;
  deviceType: string;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
};
export type TaskStatus = 'open' | 'in_progress' | 'done' | 'dismissed';
export type Task = {
  id: string;
  clientId: string | null;
  clientName: string | null;
  type: string;
  title: string;
  payload: Record<string, unknown> | null;
  status: TaskStatus;
  assignedTo: string | null;
  resolvedAt: string | null;
  createdAt: string;
};
export type TaskAction = 'claim' | 'resolve' | 'dismiss';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Talks to the Fluvia API with the session cookie (HttpOnly: this code never sees it).
 * Every request that changes something carries the CSRF header the API requires.
 */
export function createConsoleApi(baseUrl: string, fetchFn: typeof fetch = fetch) {
  const root = baseUrl.replace(/\/+$/, '');

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (method !== 'GET') {
      headers['content-type'] = 'application/json';
      headers['x-fluvia-csrf'] = '1';
    }
    const response = await fetchFn(`${root}${path}`, {
      method,
      credentials: 'include',
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new ApiError(response.status, `HTTP ${response.status}`);
    return (await response.json()) as T;
  }

  const post = <T>(path: string, body?: unknown) => call<T>('POST', path, body ?? {});

  return {
    requestCode: (email: string) => post<{ ok: true }>('/auth/login', { email }),
    verifyCode: (email: string, code: string) =>
      post<{ next: 'second_factor' | 'enroll'; methods: Methods }>('/auth/verify', {
        email,
        code,
      }),
    passkeyLoginOptions: () =>
      post<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }>(
        '/auth/passkey/login/options',
      ),
    passkeyLoginVerify: (challengeId: string, response: AuthenticationResponseJSON) =>
      post<{ ok: true }>('/auth/passkey/login/verify', { challengeId, response }),
    passkeyRegisterOptions: () =>
      post<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }>(
        '/auth/passkey/register/options',
      ),
    passkeyRegisterVerify: (
      challengeId: string,
      deviceName: string,
      response: RegistrationResponseJSON,
    ) =>
      post<{ passkey: Passkey; recoveryCodes: string[] | null }>('/auth/passkey/register/verify', {
        challengeId,
        deviceName,
        response,
      }),
    listPasskeys: () => call<{ passkeys: Passkey[] }>('GET', '/auth/passkeys'),
    deletePasskey: (id: string) =>
      call<{ ok: true }>('DELETE', `/auth/passkeys/${encodeURIComponent(id)}`),
    startEnrollment: () => post<{ secret: string; otpauthUri: string }>('/auth/totp/enroll'),
    confirmEnrollment: (code: string) =>
      post<{ recoveryCodes: string[] }>('/auth/totp/confirm', { code }),
    verifyTotp: (code: string) => post<{ ok: true }>('/auth/totp/verify', { code }),
    useRecoveryCode: (code: string) => post<{ ok: true }>('/auth/recovery', { code }),
    me: () => call<Me>('GET', '/auth/me'),
    logout: () => post<{ ok: true }>('/auth/logout'),
    listTasks: (params: { status: TaskStatus[]; cursor?: string | null }) => {
      const query = new URLSearchParams({ status: params.status.join(',') });
      if (params.cursor) query.set('cursor', params.cursor);
      return call<{ tasks: Task[]; nextCursor: string | null }>(
        'GET',
        `/console/tasks?${query.toString()}`,
      );
    },
    taskAction: (id: string, action: TaskAction, note?: string) =>
      post<Task>(`/console/tasks/${encodeURIComponent(id)}/${action}`, note ? { note } : undefined),
  };
}

export type ConsoleApi = ReturnType<typeof createConsoleApi>;
