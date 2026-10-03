import { describe, expect, it } from 'vitest';
import { createFakeAuthenticator, type Tamper } from './fake-authenticator';
import { authHarness, cookieOf, currentCode, WEB } from './test-utils';

const EMAIL = 'angela@fluvia.test';
const NOW = new Date('2026-10-03T12:00:00.000Z');
const RP = { rpId: 'app.fluvia.test', origin: WEB };

type Harness = ReturnType<typeof authHarness>;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const staffId = (h: Harness) => [...h.staff.values()][0]?.id ?? '';

async function emailStage(h: Harness) {
  await h.call('/auth/login', { body: { email: EMAIL } });
  const res = await h.call('/auth/verify', { body: { email: EMAIL, code: h.sent.at(-1)?.code } });
  return { res, cookie: cookieOf(res) };
}

/** First enrollment with a passkey instead of TOTP. */
async function enrollPasskey(h: Harness, tamper: Tamper = {}, name = 'MacBook de Angela') {
  const { cookie } = await emailStage(h);
  const auth = await createFakeAuthenticator({ ...RP, userHandle: staffId(h) });
  const start = (await (await h.call('/auth/passkey/register/options', { cookie })).json()) as Json;
  const res = await h.call('/auth/passkey/register/verify', {
    cookie,
    body: {
      challengeId: start.challengeId,
      deviceName: name,
      response: await auth.register(start.options, tamper),
    },
  });
  return { auth, res, cookie, start };
}

async function passkeyLogin(
  h: Harness,
  auth: Awaited<ReturnType<typeof createFakeAuthenticator>>,
  tamper: Tamper = {},
  ip = '1.1.1.1',
) {
  const start = (await (await h.call('/auth/passkey/login/options', { ip })).json()) as Json;
  const res = await h.call('/auth/passkey/login/verify', {
    ip,
    body: {
      challengeId: start.challengeId,
      response: await auth.authenticate(start.options, tamper),
    },
  });
  return { res, start };
}

describe('passkey registration', () => {
  it('registers the first passkey after the email code and completes the login', async () => {
    const h = authHarness();
    const { res, cookie: half } = await enrollPasskey(h);
    expect(res.status).toBe(201);
    const body = (await res.json()) as Json;
    expect(body.passkey.deviceName).toBe('MacBook de Angela');
    expect(body.recoveryCodes).toHaveLength(10);
    const full = cookieOf(res);
    expect(full).toBeTruthy();
    expect(full).not.toBe(half);
    expect((await h.call('/auth/me', { method: 'GET', cookie: full })).status).toBe(200);
    // Only the public key is stored.
    expect(h.passkeys).toHaveLength(1);
    expect(Object.keys(h.passkeys[0] ?? {})).not.toContain('privateKey');
  });

  it('asks for a discoverable, user-verified passkey bound to the app domain', async () => {
    const h = authHarness();
    const { cookie } = await emailStage(h);
    const { options } = (await (
      await h.call('/auth/passkey/register/options', { cookie })
    ).json()) as Json;
    expect(options.rp).toMatchObject({ id: 'app.fluvia.test' });
    expect(options.authenticatorSelection).toMatchObject({
      residentKey: 'required',
      userVerification: 'required',
    });
    expect(options.attestation).toBe('none');
  });

  it.each([
    ['another origin', { origin: 'https://evil.test' }],
    ['another domain', { rpId: 'evil.test' }],
    ['a different challenge', { challenge: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }],
    ['no user verification', { userVerified: false }],
  ] satisfies [string, Tamper][])('rejects registration with %s', async (_name, tamper) => {
    const h = authHarness();
    const { res } = await enrollPasskey(h, tamper);
    expect(res.status).toBe(401);
    expect(h.passkeys).toHaveLength(0);
  });

  it('a challenge works once, even if the first try failed', async () => {
    const h = authHarness();
    const { cookie } = await emailStage(h);
    const auth = await createFakeAuthenticator({ ...RP, userHandle: staffId(h) });
    const start = (await (
      await h.call('/auth/passkey/register/options', { cookie })
    ).json()) as Json;
    const good = await auth.register(start.options);
    const first = await h.call('/auth/passkey/register/verify', {
      cookie,
      body: {
        challengeId: start.challengeId,
        deviceName: 'x',
        response: await auth.register(start.options, { origin: 'https://evil.test' }),
      },
    });
    expect(first.status).toBe(401);
    const retry = await h.call('/auth/passkey/register/verify', {
      cookie,
      body: { challengeId: start.challengeId, deviceName: 'x', response: good },
    });
    expect(retry.status).toBe(401);
    expect(h.passkeys).toHaveLength(0);
  });

  it('expires challenges after 5 minutes', async () => {
    const h = authHarness();
    const { cookie } = await emailStage(h);
    const auth = await createFakeAuthenticator({ ...RP });
    const start = (await (
      await h.call('/auth/passkey/register/options', { cookie })
    ).json()) as Json;
    h.setNow(new Date(NOW.getTime() + 6 * 60_000));
    const res = await h.call('/auth/passkey/register/verify', {
      cookie,
      body: {
        challengeId: start.challengeId,
        deviceName: 'x',
        response: await auth.register(start.options),
      },
    });
    expect(res.status).toBe(401);
  });

  it('a challenge issued to one person cannot be used by another', async () => {
    const h = authHarness({ seed: [{ email: EMAIL }, { email: 'luis@fluvia.test' }] });
    const angela = await emailStage(h);
    const start = (await (
      await h.call('/auth/passkey/register/options', { cookie: angela.cookie })
    ).json()) as Json;
    const luis = await h.loginAs('luis@fluvia.test', 'email_verified');
    const auth = await createFakeAuthenticator({ ...RP });
    const res = await h.call('/auth/passkey/register/verify', {
      cookie: luis,
      body: {
        challengeId: start.challengeId,
        deviceName: 'x',
        response: await auth.register(start.options),
      },
    });
    expect(res.status).toBe(401);
    expect(h.passkeys).toHaveLength(0);
  });

  it('SECURITY: the email step alone cannot add a passkey to an account that already has a second factor', async () => {
    const h = authHarness();
    const { auth } = await enrollPasskey(h); // Angela's real passkey
    expect(auth).toBeTruthy();
    const attacker = await emailStage(h); // someone who can read her mailbox
    expect(
      (await h.call('/auth/passkey/register/options', { cookie: attacker.cookie })).status,
    ).toBe(409);
    expect((await h.call('/auth/totp/enroll', { cookie: attacker.cookie })).status).toBe(409);
    expect(h.passkeys).toHaveLength(1);
  });

  it('SECURITY: the same holds when the existing factor is TOTP', async () => {
    const h = authHarness();
    const first = await emailStage(h);
    const enroll = (await (
      await h.call('/auth/totp/enroll', { cookie: first.cookie })
    ).json()) as Json;
    await h.call('/auth/totp/confirm', {
      cookie: first.cookie,
      body: { code: await currentCode(enroll.secret, NOW) },
    });
    const attacker = await emailStage(h);
    expect(
      (await h.call('/auth/passkey/register/options', { cookie: attacker.cookie })).status,
    ).toBe(409);
  });

  it('a full session can add more passkeys; names are validated', async () => {
    const h = authHarness();
    const { res } = await enrollPasskey(h);
    const full = cookieOf(res);
    const second = await createFakeAuthenticator({ ...RP, userHandle: staffId(h) });
    const start = (await (
      await h.call('/auth/passkey/register/options', { cookie: full })
    ).json()) as Json;
    expect(start.options.excludeCredentials).toHaveLength(1);
    const bad = await h.call('/auth/passkey/register/verify', {
      cookie: full,
      body: {
        challengeId: start.challengeId,
        deviceName: '<img onerror=x>',
        response: await second.register(start.options),
      },
    });
    expect(bad.status).toBe(400);
    const start2 = (await (
      await h.call('/auth/passkey/register/options', { cookie: full })
    ).json()) as Json;
    const ok = await h.call('/auth/passkey/register/verify', {
      cookie: full,
      body: {
        challengeId: start2.challengeId,
        deviceName: 'Llave USB',
        response: await second.register(start2.options),
      },
    });
    expect(ok.status).toBe(201);
    expect(((await ok.json()) as Json).recoveryCodes).toBeNull(); // already has codes
    expect(h.passkeys).toHaveLength(2);
  });
});

describe('passkey login (no email code)', () => {
  it('logs in with one gesture and sets the session cookie', async () => {
    const h = authHarness();
    const { auth } = await enrollPasskey(h);
    const { res } = await passkeyLogin(h, auth);
    expect(res.status).toBe(200);
    const cookie = cookieOf(res);
    expect(res.headers.get('set-cookie')).toMatch(
      /^__Host-fluvia_session=.*HttpOnly.*Secure.*SameSite=Lax/i,
    );
    expect(await (await h.call('/auth/me', { method: 'GET', cookie })).json()).toMatchObject({
      email: EMAIL,
      hasPasskey: true,
    });
    expect(h.sent).toHaveLength(1); // only the enrollment email; no code for the passkey login
  });

  it('asks the browser for any discoverable passkey with user verification', async () => {
    const h = authHarness();
    const { options } = (await (await h.call('/auth/passkey/login/options')).json()) as Json;
    expect(options.rpId).toBe('app.fluvia.test');
    expect(options.userVerification).toBe('required');
    expect(options.allowCredentials ?? []).toHaveLength(0);
  });

  it('refuses a replayed challenge', async () => {
    const h = authHarness();
    const { auth } = await enrollPasskey(h);
    const start = (await (await h.call('/auth/passkey/login/options')).json()) as Json;
    const response = await auth.authenticate(start.options);
    const body = { challengeId: start.challengeId, response };
    expect((await h.call('/auth/passkey/login/verify', { body })).status).toBe(200);
    expect((await h.call('/auth/passkey/login/verify', { body })).status).toBe(401);
  });

  it.each([
    ['another origin (phishing site)', { origin: 'https://evil.test' }],
    ['another domain', { rpId: 'evil.test' }],
    ['a different challenge', { challenge: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }],
    ['no user verification', { userVerified: false }],
  ] satisfies [string, Tamper][])('rejects login with %s', async (_name, tamper) => {
    const h = authHarness();
    const { auth } = await enrollPasskey(h);
    const { res } = await passkeyLogin(h, auth, tamper);
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('rejects a credential nobody registered', async () => {
    const h = authHarness();
    await enrollPasskey(h);
    const stranger = await createFakeAuthenticator({ ...RP });
    expect((await passkeyLogin(h, stranger)).res.status).toBe(401);
  });

  it('SECURITY: detects a cloned key when the counter does not go up', async () => {
    const h = authHarness();
    const { auth } = await enrollPasskey(h);
    expect((await passkeyLogin(h, auth, { counter: 5 })).res.status).toBe(200);
    expect((await passkeyLogin(h, auth, { counter: 3 })).res.status).toBe(401);
    expect((await passkeyLogin(h, auth, { counter: 5 })).res.status).toBe(401);
    expect((await passkeyLogin(h, auth, { counter: 6 })).res.status).toBe(200);
    // The library already refuses a lower counter; the store's atomic check is a second wall.
    expect(
      h.audits.filter((a) => JSON.stringify(a).includes('auth.passkey_login_failed')),
    ).toHaveLength(2);
  });

  it('accepts authenticators that never count (counter stays 0)', async () => {
    const h = authHarness();
    const { auth } = await enrollPasskey(h);
    expect((await passkeyLogin(h, auth, { counter: 0 })).res.status).toBe(200);
    expect((await passkeyLogin(h, auth, { counter: 0 })).res.status).toBe(200);
  });

  it('refuses a disabled person and a passkey whose owner handle differs', async () => {
    const h = authHarness();
    const { auth } = await enrollPasskey(h);
    h.staff.forEach((s) => (s.disabledAt = new Date(0)));
    expect((await passkeyLogin(h, auth)).res.status).toBe(401);
    h.staff.forEach((s) => (s.disabledAt = null));
    const liar = await createFakeAuthenticator({ ...RP, userHandle: 'someone-else' });
    const first = await h.loginAs(EMAIL);
    const start = (await (
      await h.call('/auth/passkey/register/options', { cookie: first })
    ).json()) as Json;
    await h.call('/auth/passkey/register/verify', {
      cookie: first,
      body: {
        challengeId: start.challengeId,
        deviceName: 'liar',
        response: await liar.register(start.options),
      },
    });
    expect((await passkeyLogin(h, liar)).res.status).toBe(401);
  });

  it('limits attempts per IP', async () => {
    const h = authHarness();
    let last = 0;
    for (let i = 0; i < 12; i++)
      last = (await h.call('/auth/passkey/login/options', { ip: '7.7.7.7' })).status;
    expect(last).toBe(429);
  });

  it('sends the passkey methods in the email step and recovery codes still work', async () => {
    const h = authHarness();
    const { res: enrolled } = await enrollPasskey(h);
    const { recoveryCodes } = (await enrolled.json()) as Json;
    const next = await emailStage(h);
    expect(await next.res.json()).toEqual({
      next: 'second_factor',
      methods: { totp: false, passkey: true },
    });
    const rec = await h.call('/auth/recovery', {
      cookie: next.cookie,
      body: { code: recoveryCodes[0] },
    });
    expect(rec.status).toBe(200);
  });
});

describe('managing passkeys', () => {
  it('lists my passkeys without key material and removes one', async () => {
    const h = authHarness();
    const { res } = await enrollPasskey(h);
    const full = cookieOf(res);
    const second = await createFakeAuthenticator({ ...RP, userHandle: staffId(h) });
    const start = (await (
      await h.call('/auth/passkey/register/options', { cookie: full })
    ).json()) as Json;
    await h.call('/auth/passkey/register/verify', {
      cookie: full,
      body: {
        challengeId: start.challengeId,
        deviceName: 'Llave USB',
        response: await second.register(start.options),
      },
    });
    const list = (await (
      await h.call('/auth/passkeys', { method: 'GET', cookie: full })
    ).json()) as Json;
    expect(list.passkeys.map((p: Json) => p.deviceName)).toEqual([
      'MacBook de Angela',
      'Llave USB',
    ]);
    expect(JSON.stringify(list)).not.toMatch(/publicKey|credentialId|counter/);
    expect(
      (await h.call(`/auth/passkeys/${list.passkeys[1].id}`, { method: 'DELETE', cookie: full }))
        .status,
    ).toBe(200);
    expect(h.passkeys).toHaveLength(1);
  });

  it('never removes the last sign-in method, but may if TOTP exists', async () => {
    const h = authHarness();
    const { res } = await enrollPasskey(h);
    const full = cookieOf(res);
    const list = (await (
      await h.call('/auth/passkeys', { method: 'GET', cookie: full })
    ).json()) as Json;
    const id = list.passkeys[0].id;
    expect((await h.call(`/auth/passkeys/${id}`, { method: 'DELETE', cookie: full })).status).toBe(
      409,
    );
    h.staff.forEach((s) => (s.totpEnrolledAt = new Date(0)));
    expect((await h.call(`/auth/passkeys/${id}`, { method: 'DELETE', cookie: full })).status).toBe(
      200,
    );
  });

  it("nobody can remove or see someone else's passkey; ids are validated", async () => {
    const h = authHarness({ seed: [{ email: EMAIL }, { email: 'luis@fluvia.test' }] });
    await enrollPasskey(h);
    const luis = await h.loginAs('luis@fluvia.test');
    const id = h.passkeys[0]?.id ?? '';
    expect(
      ((await (await h.call('/auth/passkeys', { method: 'GET', cookie: luis })).json()) as Json)
        .passkeys,
    ).toEqual([]);
    expect((await h.call(`/auth/passkeys/${id}`, { method: 'DELETE', cookie: luis })).status).toBe(
      404,
    );
    expect(
      (await h.call('/auth/passkeys/not-a-uuid', { method: 'DELETE', cookie: luis })).status,
    ).toBe(400);
    expect(h.passkeys).toHaveLength(1);
  });

  it('requires a full session and the CSRF protections for every passkey route', async () => {
    const h = authHarness();
    const half = (await emailStage(h)).cookie;
    for (const [method, path] of [
      ['GET', '/auth/passkeys'],
      ['DELETE', `/auth/passkeys/${crypto.randomUUID()}`],
    ] as const) {
      expect((await h.call(path, { method })).status).toBe(401);
      expect((await h.call(path, { method, cookie: half })).status).toBe(401);
    }
    expect((await h.call('/auth/passkey/register/options')).status).toBe(401);
    expect(
      (await h.call('/auth/passkey/login/options', { origin: 'https://evil.test' })).status,
    ).toBe(403);
    expect((await h.call('/auth/passkey/login/verify', { csrf: false, body: {} })).status).toBe(
      403,
    );
  });

  it('rejects malformed passkey bodies', async () => {
    const h = authHarness();
    for (const body of [
      {},
      { challengeId: 'x', response: {} },
      {
        challengeId: crypto.randomUUID(),
        response: {
          id: 'a',
          rawId: 'a',
          type: 'password',
          response: {},
          clientExtensionResults: {},
        },
      },
    ]) {
      expect((await h.call('/auth/passkey/login/verify', { body })).status).toBe(400);
    }
  });
});

describe('audit', () => {
  it('records passkey events without key material', async () => {
    const h = authHarness();
    const { auth } = await enrollPasskey(h);
    await passkeyLogin(h, auth);
    await passkeyLogin(h, auth, { origin: 'https://evil.test' });
    const actions = h.audits.map((a) => (a as unknown as { action: string }).action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'auth.passkey_registered',
        'auth.login',
        'auth.passkey_login_failed',
      ]),
    );
    const dump = JSON.stringify(h.audits);
    expect(dump).not.toContain(auth.credentialId);
  });
});
