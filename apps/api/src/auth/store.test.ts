import { createDb } from '@fluvia/db';
import { describe, expect, it } from 'vitest';
import { advanceTotpStepQuery, consumeRecoveryCodeQuery, takeCodeAttemptQuery } from './store';

// A dummy URL: building a query never connects.
const db = createDb('postgres://user:pass@localhost/db');
const sqlOf = (q: unknown) => (q as { toSQL(): { sql: string; params: unknown[] } }).toSQL();
const ID = '0b6f6f9e-1c1a-4d5e-9a57-2f2f7b1b0a11';
const NOW = new Date('2026-10-03T12:00:00Z');

describe('atomic statements', () => {
  it('counts a code try and checks the limit in the same statement', () => {
    const { sql, params } = sqlOf(
      takeCodeAttemptQuery(db, { staffUserId: ID, now: NOW, maxAttempts: 5 }),
    );
    expect(sql).toMatch(/^update "login_codes" set "attempts" = "login_codes"."attempts" \+ 1/);
    expect(sql).toContain('"consumed_at" is null');
    expect(sql).toContain('"expires_at" >');
    expect(sql).toContain('"attempts" <');
    expect(sql).toMatch(/order by .*"created_at" desc limit 1/);
    expect(sql).toContain('returning');
    expect(params).toContain(ID);
    expect(params).toContain(5);
  });

  it('removes a recovery code only if it is still there (single use)', () => {
    const { sql, params } = sqlOf(consumeRecoveryCodeQuery(db, ID, 'abc'));
    expect(sql).toContain('"recovery_code_hashes" - $');
    expect(sql).toContain('"recovery_code_hashes" ? $');
    expect(sql).toContain('returning');
    expect(params).toContain('abc');
  });

  it('only advances the TOTP step forward (no replay)', () => {
    const { sql, params } = sqlOf(advanceTotpStepQuery(db, ID, 123));
    expect(sql).toContain('"totp_last_step" is null or');
    expect(sql).toContain('"totp_last_step" <');
    expect(params).toContain(123);
  });
});
