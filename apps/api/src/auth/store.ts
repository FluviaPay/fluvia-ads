import { authSessions, loginCodes, staffUsers, type Db } from '@fluvia/db';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';

export type Role = 'admin' | 'operator';
export type Stage = 'email_verified' | 'full';

export type StaffRecord = {
  id: string;
  email: string;
  name: string;
  role: Role;
  totpSecretEnc: string | null;
  totpEnrolledAt: Date | null;
  totpLastStep: number | null;
  disabledAt: Date | null;
};

export type SessionRecord = {
  id: string;
  staffUserId: string;
  stage: Stage;
  mfaAttempts: number;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
};

/**
 * Everything the login needs from the database. Every "check and change" is ONE statement
 * (atomic), because the Neon HTTP driver has no interactive transactions and two requests
 * can race (two tries of the same code, two uses of the same recovery code).
 */
export type AuthStore = {
  findStaffByEmail(email: string): Promise<StaffRecord | null>;
  findStaffById(id: string): Promise<StaffRecord | null>;
  listStaff(): Promise<(StaffRecord & { createdAt: Date })[]>;
  /** Null when the email already exists. */
  createStaff(input: { email: string; name: string; role: Role }): Promise<StaffRecord | null>;
  setDisabled(id: string, disabledAt: Date | null): Promise<boolean>;
  /** Removes TOTP and recovery codes so the person enrolls again; revokes their sessions. */
  resetTotp(id: string, now: Date): Promise<void>;

  /** Invalidates the user's earlier codes and stores the new one. */
  createLoginCode(input: {
    staffUserId: string;
    codeHash: string;
    expiresAt: Date;
    now: Date;
  }): Promise<void>;
  /** Counts one try on the newest live code (atomic) and returns its hash; null if none left. */
  takeCodeAttempt(input: {
    staffUserId: string;
    now: Date;
    maxAttempts: number;
  }): Promise<{ id: string; codeHash: string } | null>;
  /** True only for the first caller: marks the code used. */
  consumeLoginCode(id: string, now: Date): Promise<boolean>;

  createSession(input: {
    staffUserId: string;
    tokenHash: string;
    stage: Stage;
    expiresAt: Date;
    now: Date;
  }): Promise<void>;
  findSession(tokenHash: string): Promise<{ session: SessionRecord; staff: StaffRecord } | null>;
  touchSession(id: string, now: Date): Promise<void>;
  /** Counts one wrong second-factor try and returns the new total. */
  bumpMfaAttempts(id: string): Promise<number>;
  revokeSession(id: string, now: Date): Promise<void>;
  revokeStaffSessions(staffUserId: string, now: Date): Promise<void>;

  saveProposedTotp(staffUserId: string, secretEnc: string): Promise<void>;
  /** Marks the TOTP enrolled, remembers the accepted step and stores the recovery hashes. */
  confirmTotp(input: {
    staffUserId: string;
    step: number;
    recoveryCodeHashes: string[];
    now: Date;
  }): Promise<boolean>;
  /** Atomic anti-replay: true only if `step` is newer than the stored one. */
  advanceTotpStep(staffUserId: string, step: number): Promise<boolean>;
  /** Atomic and single-use: true only for the first caller with an unused code. */
  consumeRecoveryCode(staffUserId: string, codeHash: string): Promise<boolean>;
};

const staffColumns = {
  id: staffUsers.id,
  email: staffUsers.email,
  name: staffUsers.name,
  role: staffUsers.role,
  totpSecretEnc: staffUsers.totpSecretEnc,
  totpEnrolledAt: staffUsers.totpEnrolledAt,
  totpLastStep: staffUsers.totpLastStep,
  disabledAt: staffUsers.disabledAt,
};

const sessionColumns = {
  id: authSessions.id,
  staffUserId: authSessions.staffUserId,
  stage: authSessions.stage,
  mfaAttempts: authSessions.mfaAttempts,
  lastSeenAt: authSessions.lastSeenAt,
  expiresAt: authSessions.expiresAt,
  revokedAt: authSessions.revokedAt,
};

/** Statement shapes are exported so tests can check the SQL of the atomic ones. */
export const takeCodeAttemptQuery = (
  db: Db,
  input: { staffUserId: string; now: Date; maxAttempts: number },
) =>
  db
    .update(loginCodes)
    .set({ attempts: sql`${loginCodes.attempts} + 1` })
    .where(
      eq(
        loginCodes.id,
        sql`(select ${loginCodes.id} from ${loginCodes}
          where ${and(
            eq(loginCodes.staffUserId, input.staffUserId),
            isNull(loginCodes.consumedAt),
            gt(loginCodes.expiresAt, input.now),
            sql`${loginCodes.attempts} < ${input.maxAttempts}`,
          )}
          order by ${desc(loginCodes.createdAt)} limit 1)`,
      ),
    )
    .returning({ id: loginCodes.id, codeHash: loginCodes.codeHash });

export const consumeRecoveryCodeQuery = (db: Db, staffUserId: string, codeHash: string) =>
  db
    .update(staffUsers)
    .set({ recoveryCodeHashes: sql`${staffUsers.recoveryCodeHashes} - ${codeHash}::text` })
    .where(
      and(
        eq(staffUsers.id, staffUserId),
        sql`${staffUsers.recoveryCodeHashes} ? ${codeHash}::text`,
      ),
    )
    .returning({ id: staffUsers.id });

export const advanceTotpStepQuery = (db: Db, staffUserId: string, step: number) =>
  db
    .update(staffUsers)
    .set({ totpLastStep: step })
    .where(
      and(
        eq(staffUsers.id, staffUserId),
        sql`(${staffUsers.totpLastStep} is null or ${staffUsers.totpLastStep} < ${step})`,
      ),
    )
    .returning({ id: staffUsers.id });

export function createAuthStore(db: Db): AuthStore {
  const staffBy = async (where: ReturnType<typeof eq>) => {
    const [row] = await db.select(staffColumns).from(staffUsers).where(where).limit(1);
    return row ?? null;
  };

  return {
    findStaffByEmail: (email) => staffBy(eq(staffUsers.email, email)),
    findStaffById: (id) => staffBy(eq(staffUsers.id, id)),

    async listStaff() {
      return db
        .select({ ...staffColumns, createdAt: staffUsers.createdAt })
        .from(staffUsers)
        .orderBy(staffUsers.createdAt);
    },

    async createStaff(input) {
      const [row] = await db
        .insert(staffUsers)
        .values(input)
        .onConflictDoNothing({ target: staffUsers.email })
        .returning(staffColumns);
      return row ?? null;
    },

    async setDisabled(id, disabledAt) {
      const rows = await db
        .update(staffUsers)
        .set({ disabledAt })
        .where(eq(staffUsers.id, id))
        .returning({ id: staffUsers.id });
      return rows.length > 0;
    },

    async resetTotp(id, now) {
      await db.batch([
        db
          .update(staffUsers)
          .set({
            totpSecretEnc: null,
            totpEnrolledAt: null,
            totpLastStep: null,
            recoveryCodeHashes: [],
          })
          .where(eq(staffUsers.id, id)),
        db
          .update(authSessions)
          .set({ revokedAt: now })
          .where(and(eq(authSessions.staffUserId, id), isNull(authSessions.revokedAt))),
      ]);
    },

    async createLoginCode({ staffUserId, codeHash, expiresAt, now }) {
      await db.batch([
        db
          .update(loginCodes)
          .set({ consumedAt: now })
          .where(and(eq(loginCodes.staffUserId, staffUserId), isNull(loginCodes.consumedAt))),
        db.insert(loginCodes).values({ staffUserId, codeHash, expiresAt }),
      ]);
    },

    async takeCodeAttempt(input) {
      const [row] = await takeCodeAttemptQuery(db, input);
      return row ?? null;
    },

    async consumeLoginCode(id, now) {
      const rows = await db
        .update(loginCodes)
        .set({ consumedAt: now })
        .where(and(eq(loginCodes.id, id), isNull(loginCodes.consumedAt)))
        .returning({ id: loginCodes.id });
      return rows.length > 0;
    },

    async createSession({ staffUserId, tokenHash, stage, expiresAt, now }) {
      await db
        .insert(authSessions)
        .values({ staffUserId, tokenHash, stage, expiresAt, lastSeenAt: now });
    },

    async findSession(tokenHash) {
      const [row] = await db
        .select({
          session: sessionColumns,
          staff: staffColumns,
        })
        .from(authSessions)
        .innerJoin(staffUsers, eq(staffUsers.id, authSessions.staffUserId))
        .where(eq(authSessions.tokenHash, tokenHash))
        .limit(1);
      return row ?? null;
    },

    async touchSession(id, now) {
      await db.update(authSessions).set({ lastSeenAt: now }).where(eq(authSessions.id, id));
    },

    async bumpMfaAttempts(id) {
      const [row] = await db
        .update(authSessions)
        .set({ mfaAttempts: sql`${authSessions.mfaAttempts} + 1` })
        .where(eq(authSessions.id, id))
        .returning({ n: authSessions.mfaAttempts });
      return row?.n ?? Number.MAX_SAFE_INTEGER;
    },

    async revokeSession(id, now) {
      await db.update(authSessions).set({ revokedAt: now }).where(eq(authSessions.id, id));
    },

    async revokeStaffSessions(staffUserId, now) {
      await db
        .update(authSessions)
        .set({ revokedAt: now })
        .where(and(eq(authSessions.staffUserId, staffUserId), isNull(authSessions.revokedAt)));
    },

    async saveProposedTotp(staffUserId, secretEnc) {
      // Only while not enrolled: an enrolled secret is never replaced from a login session.
      await db
        .update(staffUsers)
        .set({ totpSecretEnc: secretEnc })
        .where(and(eq(staffUsers.id, staffUserId), isNull(staffUsers.totpEnrolledAt)));
    },

    async confirmTotp({ staffUserId, step, recoveryCodeHashes, now }) {
      const rows = await db
        .update(staffUsers)
        .set({ totpEnrolledAt: now, totpLastStep: step, recoveryCodeHashes })
        .where(and(eq(staffUsers.id, staffUserId), isNull(staffUsers.totpEnrolledAt)))
        .returning({ id: staffUsers.id });
      return rows.length > 0;
    },

    async advanceTotpStep(staffUserId, step) {
      return (await advanceTotpStepQuery(db, staffUserId, step)).length > 0;
    },

    async consumeRecoveryCode(staffUserId, codeHash) {
      return (await consumeRecoveryCodeQuery(db, staffUserId, codeHash)).length > 0;
    },
  };
}
