import { describe, expect, it } from 'vitest';
import { authHarness, cookieOf, currentCode, WEB } from './test-utils';

const NOW = new Date('2026-10-03T12:00:00.000Z');
const EMAIL = 'angela@fluvia.test';

type Harness = ReturnType<typeof authHarness>;

async function emailLogin(h: Harness, email = EMAIL) {
  expect((await h.call('/auth/login', { body: { email } })).status).toBe(202);
  const code = h.sent.at(-1)?.code ?? '';
  const res = await h.call('/auth/verify', { body: { email, code } });
  return { res, cookie: cookieOf(res) };
}

/** Full first login: email code, TOTP enrollment, back with the full session. */
async function fullLogin(h: Harness) {
  const { res, cookie } = await emailLogin(h);
  expect(await res.json()).toEqual({
    next: 'enroll',
    methods: { totp: false, passkey: false },
  });
  const enroll = (await (await h.call('/auth/totp/enroll', { cookie })).json()) as {
    secret: string;
  };
  const confirm = await h.call('/auth/totp/confirm', {
    cookie,
    body: { code: await currentCode(enroll.secret, NOW) },
  });
  expect(confirm.status).toBe(200);
  const { recoveryCodes } = (await confirm.json()) as { recoveryCodes: string[] };
  return { cookie: cookieOf(confirm) ?? '', secret: enroll.secret, recoveryCodes };
}

describe('email code', () => {
  it('answers 202 with the same body for known and unknown emails', async () => {
    const h = authHarness();
    const known = await h.call('/auth/login', { body: { email: EMAIL } });
    const unknown = await h.call('/auth/login', { body: { email: 'nadie@fluvia.test' } });
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(await known.json()).toEqual(await unknown.json());
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]?.to).toBe(EMAIL);
  });

  it('does not send to disabled people', async () => {
    const h = authHarness({ seed: [{ email: EMAIL, disabledAt: new Date(0) }] });
    await h.call('/auth/login', { body: { email: EMAIL } });
    expect(h.sent).toHaveLength(0);
  });

  it('stores only a hash of the code', async () => {
    const h = authHarness();
    await h.call('/auth/login', { body: { email: EMAIL } });
    const stored = h.codes[0]?.codeHash ?? '';
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toContain(h.sent[0]?.code ?? 'x');
  });

  it('accepts the right code once and sets a hardened cookie', async () => {
    const h = authHarness();
    const { res } = await emailLogin(h);
    expect(res.status).toBe(200);
    const header = res.headers.get('set-cookie') ?? '';
    expect(header).toMatch(/^__Host-fluvia_session=/);
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/Secure/i);
    expect(header).toMatch(/SameSite=Lax/i);
    expect(header).toMatch(/Path=\//);
    expect(header).not.toMatch(/Domain=/i);
    // The same code cannot be used again.
    const again = await h.call('/auth/verify', { body: { email: EMAIL, code: h.sent[0]?.code } });
    expect(again.status).toBe(401);
  });

  it('rejects wrong, expired and unknown-user codes with the same answer', async () => {
    const h = authHarness();
    await h.call('/auth/login', { body: { email: EMAIL } });
    const real = h.sent[0]?.code ?? '';
    const wrong = real === '000000' ? '000001' : '000000';
    const a = await h.call('/auth/verify', { body: { email: EMAIL, code: wrong } });
    const b = await h.call('/auth/verify', { body: { email: 'nadie@fluvia.test', code: real } });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(await a.json()).toMatchObject({ error: { message: 'Invalid or expired code' } });
    expect(await b.json()).toMatchObject({ error: { message: 'Invalid or expired code' } });
    h.setNow(new Date(NOW.getTime() + 11 * 60_000));
    expect((await h.call('/auth/verify', { body: { email: EMAIL, code: real } })).status).toBe(401);
  });

  it('locks a code after 5 wrong tries, even if the 6th is right', async () => {
    const h = authHarness();
    await h.call('/auth/login', { body: { email: EMAIL } });
    const real = h.sent[0]?.code ?? '';
    const wrong = real === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i++) {
      expect(
        (await h.call('/auth/verify', { body: { email: EMAIL, code: wrong }, ip: `9.9.9.${i}` }))
          .status,
      ).toBe(401);
    }
    expect(
      (await h.call('/auth/verify', { body: { email: EMAIL, code: real }, ip: '9.9.9.9' })).status,
    ).toBe(401);
  });

  it('a new code invalidates the previous one', async () => {
    const h = authHarness();
    await h.call('/auth/login', { body: { email: EMAIL } });
    await h.call('/auth/login', { body: { email: EMAIL } });
    const [first, second] = h.sent;
    if (first?.code !== second?.code) {
      expect(
        (await h.call('/auth/verify', { body: { email: EMAIL, code: first?.code } })).status,
      ).toBe(401);
    }
    expect(
      (await h.call('/auth/verify', { body: { email: EMAIL, code: second?.code } })).status,
    ).toBe(200);
  });

  it('limits code requests per email and per IP', async () => {
    const h = authHarness();
    for (let i = 0; i < 7; i++) {
      await h.call('/auth/login', { body: { email: EMAIL }, ip: `2.2.2.${i}` });
    }
    expect(h.sent).toHaveLength(5); // the 6th and 7th are silently not sent
    const flood = authHarness();
    let last = 0;
    for (let i = 0; i < 12; i++) {
      last = (
        await flood.call('/auth/login', { body: { email: `x${i}@fluvia.test` }, ip: '3.3.3.3' })
      ).status;
    }
    expect(last).toBe(429);
  });

  it('rejects malformed bodies and unknown fields', async () => {
    const h = authHarness();
    expect((await h.call('/auth/login', { body: { email: 'not-an-email' } })).status).toBe(400);
    expect((await h.call('/auth/login', { body: { email: EMAIL, role: 'admin' } })).status).toBe(
      400,
    );
    expect((await h.call('/auth/verify', { body: { email: EMAIL, code: '12345' } })).status).toBe(
      400,
    );
  });
});

describe('second factor', () => {
  it('requires TOTP enrollment on first login and then gives a full session', async () => {
    const h = authHarness();
    const { cookie, recoveryCodes } = await fullLogin(h);
    expect(recoveryCodes).toHaveLength(10);
    const me = await h.call('/auth/me', { method: 'GET', cookie });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ email: EMAIL, role: 'operator' });
    // Only hashes of the recovery codes are stored, and the secret is encrypted.
    const stored = h.staff.values().next().value;
    expect(stored?.recovery).toHaveLength(10);
    expect(stored?.recovery.join()).not.toContain(recoveryCodes[0]?.replace('-', '') ?? 'x');
    expect(stored?.totpSecretEnc).toMatch(/^v1\./);
  });

  it('a session with only the email step cannot open the console', async () => {
    const h = authHarness();
    const { cookie } = await emailLogin(h);
    expect((await h.call('/auth/me', { method: 'GET', cookie })).status).toBe(401);
  });

  it('rejects a wrong enrollment code and a replayed login code', async () => {
    const h = authHarness();
    const { cookie: first, secret } = await fullLogin(h);
    expect(first).toBeTruthy();
    // New login: email code, then TOTP. The step used at enrollment cannot be reused.
    const { cookie, res } = await emailLogin(h);
    expect(await res.json()).toEqual({
      next: 'second_factor',
      methods: { totp: true, passkey: false },
    });
    expect(
      (
        await h.call('/auth/totp/verify', {
          cookie,
          body: { code: await currentCode(secret, NOW) },
        })
      ).status,
    ).toBe(401);
    const ok = await h.call('/auth/totp/verify', {
      cookie,
      body: { code: await currentCode(secret, NOW, 1) },
    });
    expect(ok.status).toBe(200);
    const full = cookieOf(ok);
    expect((await h.call('/auth/me', { method: 'GET', cookie: full })).status).toBe(200);
  });

  it('kills the half session after 5 wrong second-factor tries', async () => {
    const h = authHarness();
    const { secret } = await fullLogin(h);
    const { cookie } = await emailLogin(h);
    for (let i = 0; i < 5; i++) {
      expect((await h.call('/auth/totp/verify', { cookie, body: { code: '000000' } })).status).toBe(
        401,
      );
    }
    // Even the right code now fails: the session is revoked.
    expect(
      (
        await h.call('/auth/totp/verify', {
          cookie,
          body: { code: await currentCode(secret, NOW, 1) },
        })
      ).status,
    ).toBe(401);
  });

  it('recovery codes work once', async () => {
    const h = authHarness();
    const { recoveryCodes } = await fullLogin(h);
    const code = recoveryCodes[0] ?? '';
    const first = await emailLogin(h);
    const ok = await h.call('/auth/recovery', {
      cookie: first.cookie,
      body: { code: code.toLowerCase() },
    });
    expect(ok.status).toBe(200);
    const second = await emailLogin(h);
    expect((await h.call('/auth/recovery', { cookie: second.cookie, body: { code } })).status).toBe(
      401,
    );
  });

  it('rotates the session token when the login completes', async () => {
    const h = authHarness();
    const { cookie: half } = await emailLogin(h);
    const enroll = (await (await h.call('/auth/totp/enroll', { cookie: half })).json()) as {
      secret: string;
    };
    const done = await h.call('/auth/totp/confirm', {
      cookie: half,
      body: { code: await currentCode(enroll.secret, NOW) },
    });
    expect(cookieOf(done)).not.toBe(half);
    // The old (half) cookie is dead.
    expect((await h.call('/auth/totp/enroll', { cookie: half })).status).toBe(401);
  });
});

describe('sessions', () => {
  it('expires on inactivity and on the absolute limit', async () => {
    const h = authHarness();
    const { cookie } = await fullLogin(h);
    h.setNow(new Date(NOW.getTime() + 121 * 60_000));
    expect((await h.call('/auth/me', { method: 'GET', cookie })).status).toBe(401);

    const h2 = authHarness();
    const { cookie: c2 } = await fullLogin(h2);
    // Active every hour, but past the 12 h absolute limit.
    for (let hour = 1; hour <= 11; hour++) {
      h2.setNow(new Date(NOW.getTime() + hour * 3_600_000));
      expect((await h2.call('/auth/me', { method: 'GET', cookie: c2 })).status).toBe(200);
    }
    h2.setNow(new Date(NOW.getTime() + 12.5 * 3_600_000));
    expect((await h2.call('/auth/me', { method: 'GET', cookie: c2 })).status).toBe(401);
  });

  it('logout revokes the session server-side', async () => {
    const h = authHarness();
    const { cookie } = await fullLogin(h);
    expect((await h.call('/auth/logout', { cookie })).status).toBe(200);
    expect((await h.call('/auth/me', { method: 'GET', cookie })).status).toBe(401);
  });

  it('a disabled person loses the session immediately', async () => {
    const h = authHarness();
    const { cookie } = await fullLogin(h);
    h.staff.forEach((s) => (s.disabledAt = new Date(0)));
    expect((await h.call('/auth/me', { method: 'GET', cookie })).status).toBe(401);
  });

  it('ignores garbage cookies', async () => {
    const h = authHarness();
    for (const cookie of [
      '__Host-fluvia_session=',
      '__Host-fluvia_session=' + 'x'.repeat(500),
      '__Host-fluvia_session=abc',
    ]) {
      expect((await h.call('/auth/me', { method: 'GET', cookie })).status).toBe(401);
    }
  });
});

describe('browser protections', () => {
  it('refuses state-changing calls from another origin or without the CSRF header', async () => {
    const h = authHarness();
    expect(
      (await h.call('/auth/login', { body: { email: EMAIL }, origin: 'https://evil.test' })).status,
    ).toBe(403);
    expect((await h.call('/auth/login', { body: { email: EMAIL }, origin: null })).status).toBe(
      403,
    );
    expect((await h.call('/auth/login', { body: { email: EMAIL }, csrf: false })).status).toBe(403);
    expect(h.sent).toHaveLength(0);
  });

  it('answers CORS only for the web origin, with credentials', async () => {
    const h = authHarness();
    const ok = await h.app.request(
      '/auth/me',
      { method: 'OPTIONS', headers: { origin: WEB, 'access-control-request-method': 'GET' } },
      h.env,
    );
    expect(ok.headers.get('access-control-allow-origin')).toBe(WEB);
    expect(ok.headers.get('access-control-allow-credentials')).toBe('true');
    const bad = await h.app.request(
      '/auth/me',
      {
        method: 'OPTIONS',
        headers: { origin: 'https://evil.test', 'access-control-request-method': 'GET' },
      },
      h.env,
    );
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('sends security headers and never caches auth answers', async () => {
    const h = authHarness();
    const res = await h.call('/auth/me', { method: 'GET' });
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(res.headers.get('strict-transport-security')).toContain('max-age=');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects oversized bodies', async () => {
    const h = authHarness();
    const res = await h.app.request(
      '/auth/login',
      {
        method: 'POST',
        headers: {
          origin: WEB,
          'x-fluvia-csrf': '1',
          'content-type': 'application/json',
          'content-length': '999999',
        },
        body: JSON.stringify({ email: EMAIL }),
      },
      h.env,
    );
    expect(res.status).toBe(413);
  });
});

describe('configuration and audit', () => {
  it('answers 503 naming only the missing setting names', async () => {
    const h = authHarness({ env: { AUTH_SECRET: undefined } });
    const res = await h.call('/auth/login', { body: { email: EMAIL } });
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain('aaaa');
  });

  it('records the login events in audit_log without secrets', async () => {
    const h = authHarness();
    await fullLogin(h);
    const actions = h.audits.map((a) => (a as unknown as { action: string }).action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'auth.login_code_sent',
        'auth.email_verified',
        'auth.totp_enrolled',
        'auth.login',
      ]),
    );
    const dump = JSON.stringify(h.audits);
    for (const mail of h.sent) expect(dump).not.toContain(mail.code);
  });
});
