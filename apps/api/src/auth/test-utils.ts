import type { AuditEntry } from '../audit';
import { createApp } from '../app';
import type { Bindings } from '../env';
import { memoryRateLimiter } from './rate-limit';
import { sha256Hex } from './secrets';
import type { AuthStore, PasskeyRecord, SessionRecord, StaffRecord } from './store';
import { base32Decode } from './totp';
import { hotp, totpStep } from './totp';
import type { Mailer } from './mailer';
import type { TaskStore } from '../console/tasks-store';

export const WEB = 'https://app.fluvia.test';

export const authEnv = {
  APP_VERSION: '1.2.3',
  ENVIRONMENT: 'production',
  AUTH_SECRET: 'a'.repeat(40),
  TOKEN_ENCRYPTION_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(9))),
  WEB_BASE_URL: WEB,
  API_BASE_URL: 'https://api.fluvia.test',
  EMAIL_FROM: 'Fluvia <no-reply@fluvia.test>',
  RESEND_API_KEY: 're_test',
} as unknown as Bindings;

/** In-memory store with the same atomic semantics as the SQL one. */
export function memoryAuthStore(seed: Partial<StaffRecord>[] = []) {
  type Code = {
    id: string;
    staffUserId: string;
    codeHash: string;
    attempts: number;
    expiresAt: Date;
    consumedAt: Date | null;
    createdAt: number;
  };
  type Session = SessionRecord & { tokenHash: string };
  type Staff = Omit<StaffRecord, 'passkeyCount'> & { recovery: string[]; createdAt: Date };
  const staff = new Map<string, Staff>();
  const passkeys: PasskeyRecord[] = [];
  const challenges: {
    id: string;
    purpose: 'register' | 'login';
    challenge: string;
    staffUserId: string | null;
    expiresAt: Date;
    consumedAt: Date | null;
  }[] = [];
  const codes: Code[] = [];
  const sessions: Session[] = [];
  let seq = 0;
  const id = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

  const addStaff = (input: Partial<Omit<StaffRecord, 'passkeyCount'>> & { email: string }) => {
    const record = {
      id: id(),
      name: 'Test',
      role: 'operator' as const,
      totpSecretEnc: null,
      totpEnrolledAt: null,
      totpLastStep: null,
      disabledAt: null,
      recovery: [] as string[],
      createdAt: new Date(0),
      ...input,
    };
    staff.set(record.id, record);
    return record;
  };
  seed.forEach((s) => addStaff(s as Partial<StaffRecord> & { email: string }));
  const view = (s: Staff): StaffRecord => ({
    id: s.id,
    email: s.email,
    name: s.name,
    role: s.role,
    totpSecretEnc: s.totpSecretEnc,
    totpEnrolledAt: s.totpEnrolledAt,
    totpLastStep: s.totpLastStep,
    disabledAt: s.disabledAt,
    passkeyCount: passkeys.filter((p) => p.staffUserId === s.id).length,
  });
  const byId = (i: string) => staff.get(i);

  const store: AuthStore = {
    async findStaffByEmail(email) {
      const s = [...staff.values()].find((x) => x.email === email);
      return s ? view(s) : null;
    },
    async findStaffById(i) {
      const s = byId(i);
      return s ? view(s) : null;
    },
    async listStaff() {
      return [...staff.values()].map((s) => ({ ...view(s), createdAt: s.createdAt }));
    },
    async createStaff(input) {
      if ([...staff.values()].some((x) => x.email === input.email)) return null;
      return view(addStaff(input));
    },
    async setDisabled(i, disabledAt) {
      const s = byId(i);
      if (!s) return false;
      s.disabledAt = disabledAt;
      return true;
    },
    async resetFactors(i, now) {
      for (let k = passkeys.length - 1; k >= 0; k--) {
        if (passkeys[k]?.staffUserId === i) passkeys.splice(k, 1);
      }
      const s = byId(i);
      if (s)
        Object.assign(s, {
          totpSecretEnc: null,
          totpEnrolledAt: null,
          totpLastStep: null,
          recovery: [],
        });
      sessions
        .filter((x) => x.staffUserId === i && !x.revokedAt)
        .forEach((x) => (x.revokedAt = now));
    },
    async createLoginCode({ staffUserId, codeHash, expiresAt, now }) {
      codes
        .filter((c) => c.staffUserId === staffUserId && !c.consumedAt)
        .forEach((c) => (c.consumedAt = now));
      codes.push({
        id: id(),
        staffUserId,
        codeHash,
        attempts: 0,
        expiresAt,
        consumedAt: null,
        createdAt: ++seq,
      });
    },
    async takeCodeAttempt({ staffUserId, now, maxAttempts }) {
      const live = codes
        .filter(
          (c) =>
            c.staffUserId === staffUserId &&
            !c.consumedAt &&
            c.expiresAt > now &&
            c.attempts < maxAttempts,
        )
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      if (!live) return null;
      live.attempts += 1;
      return { id: live.id, codeHash: live.codeHash };
    },
    async consumeLoginCode(i, now) {
      const c = codes.find((x) => x.id === i);
      if (!c || c.consumedAt) return false;
      c.consumedAt = now;
      return true;
    },
    async createSession({ staffUserId, tokenHash, stage, expiresAt, now }) {
      sessions.push({
        id: id(),
        staffUserId,
        tokenHash,
        stage,
        mfaAttempts: 0,
        lastSeenAt: now,
        expiresAt,
        revokedAt: null,
      });
    },
    async findSession(tokenHash) {
      const s = sessions.find((x) => x.tokenHash === tokenHash);
      const st = s && byId(s.staffUserId);
      return s && st ? { session: { ...s }, staff: view(st) } : null;
    },
    async touchSession(i, now) {
      const s = sessions.find((x) => x.id === i);
      if (s) s.lastSeenAt = now;
    },
    async bumpMfaAttempts(i) {
      const s = sessions.find((x) => x.id === i);
      if (!s) return Number.MAX_SAFE_INTEGER;
      return ++s.mfaAttempts;
    },
    async revokeSession(i, now) {
      const s = sessions.find((x) => x.id === i);
      if (s) s.revokedAt = now;
    },
    async revokeStaffSessions(i, now) {
      sessions
        .filter((x) => x.staffUserId === i && !x.revokedAt)
        .forEach((x) => (x.revokedAt = now));
    },
    async saveProposedTotp(i, enc) {
      const s = byId(i);
      if (s && !s.totpEnrolledAt) s.totpSecretEnc = enc;
    },
    async confirmTotp({ staffUserId, step, recoveryCodeHashes, now }) {
      const s = byId(staffUserId);
      if (!s || s.totpEnrolledAt) return false;
      Object.assign(s, { totpEnrolledAt: now, totpLastStep: step, recovery: recoveryCodeHashes });
      return true;
    },
    async advanceTotpStep(i, step) {
      const s = byId(i);
      if (!s || (s.totpLastStep !== null && s.totpLastStep >= step)) return false;
      s.totpLastStep = step;
      return true;
    },
    async consumeRecoveryCode(i, hash) {
      const s = byId(i);
      if (!s || !s.recovery.includes(hash)) return false;
      s.recovery = s.recovery.filter((h) => h !== hash);
      return true;
    },
    async setRecoveryCodesIfEmpty(i, hashes) {
      const s = byId(i);
      if (!s || s.recovery.length > 0) return false;
      s.recovery = hashes;
      return true;
    },
    async createChallenge({ purpose, challenge, staffUserId, expiresAt }) {
      const row = {
        id: crypto.randomUUID(),
        purpose,
        challenge,
        staffUserId,
        expiresAt,
        consumedAt: null,
      };
      challenges.push(row);
      return row.id;
    },
    async consumeChallenge({ id: i, purpose, now }) {
      const c = challenges.find((x) => x.id === i);
      if (!c || c.purpose !== purpose || c.consumedAt || c.expiresAt <= now) return null;
      c.consumedAt = now;
      return { challenge: c.challenge, staffUserId: c.staffUserId };
    },
    async addPasskey(input) {
      if (passkeys.some((p) => p.credentialId === input.credentialId)) return false;
      passkeys.push({
        ...input,
        id: crypto.randomUUID(),
        lastUsedAt: null,
        createdAt: new Date(0),
      });
      return true;
    },
    async findPasskeyByCredentialId(credentialId) {
      return passkeys.find((p) => p.credentialId === credentialId) ?? null;
    },
    async listPasskeys(staffUserId) {
      return passkeys.filter((p) => p.staffUserId === staffUserId);
    },
    async recordPasskeyUse({ id: i, counter, now }) {
      const p = passkeys.find((x) => x.id === i);
      if (!p || !(counter > p.counter || (counter === 0 && p.counter === 0))) return false;
      p.counter = counter;
      p.lastUsedAt = now;
      return true;
    },
    async deletePasskey(staffUserId, i) {
      const k = passkeys.findIndex((p) => p.id === i && p.staffUserId === staffUserId);
      if (k < 0) return false;
      passkeys.splice(k, 1);
      return true;
    },
  };
  return { store, staff, codes, sessions, addStaff, passkeys, challenges };
}

export function authHarness(
  options: {
    seed?: Partial<StaffRecord>[];
    now?: () => Date;
    env?: Record<string, string | undefined>;
    tasks?: TaskStore;
  } = {},
) {
  const mem = memoryAuthStore(
    options.seed ?? [{ email: 'angela@fluvia.test', name: 'Angela', role: 'operator' }],
  );
  const sent: { to: string; code: string }[] = [];
  const audits: AuditEntry[] = [];
  let clock = options.now ?? (() => new Date('2026-10-03T12:00:00.000Z'));
  const mailer: Mailer = {
    async sendLoginCode({ to, code }) {
      sent.push({ to, code });
    },
  };
  const limiter = memoryRateLimiter(() => clock().getTime());
  const env = { ...authEnv, ...options.env } as unknown as Bindings;
  const app = createApp({
    authStore: () => mem.store,
    mailer: () => mailer,
    limiter: () => limiter,
    ...(options.tasks ? { tasks: () => options.tasks as TaskStore } : {}),
    now: () => clock(),
    // The audit goes to the harness instead of the database.
    getDb: () =>
      ({
        insert: () => ({
          values: (row: Record<string, unknown>) => ({
            returning: async () => {
              audits.push(row as unknown as AuditEntry);
              return [{ id: 'audit-id' }];
            },
          }),
        }),
      }) as never,
  });
  return {
    ...mem,
    sent,
    audits,
    env,
    /** A full session for an existing person, without going through the login. */
    async loginAs(email: string, stage: 'full' | 'email_verified' = 'full') {
      const person = await mem.store.findStaffByEmail(email);
      if (!person) throw new Error(`no staff ${email}`);
      const token = `test-token-${person.id}-${stage}`;
      await mem.store.createSession({
        staffUserId: person.id,
        tokenHash: await sha256Hex(token),
        stage,
        expiresAt: new Date(clock().getTime() + 3_600_000),
        now: clock(),
      });
      return `__Host-fluvia_session=${token}`;
    },
    setNow: (d: Date) => (clock = () => d),
    app,
    async call(
      path: string,
      init: {
        method?: string;
        body?: unknown;
        cookie?: string | undefined;
        origin?: string | null;
        csrf?: boolean;
        ip?: string;
      } = {},
    ) {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        'cf-connecting-ip': init.ip ?? '1.1.1.1',
      };
      if (init.cookie) headers.cookie = init.cookie;
      if (init.origin !== null) headers.origin = init.origin ?? WEB;
      if (init.csrf !== false) headers['x-fluvia-csrf'] = '1';
      return app.request(
        path,
        {
          method: init.method ?? 'POST',
          headers,
          body: init.body === undefined ? null : JSON.stringify(init.body),
        },
        env,
      );
    },
  };
}

export const cookieOf = (res: Response): string | undefined => {
  const raw = res.headers.get('set-cookie');
  return raw?.split(';')[0];
};

export async function currentCode(secretBase32: string, now: Date, offset = 0): Promise<string> {
  return hotp(secretBase32, totpStep(now) + offset);
}

export { base32Decode, sha256Hex };
