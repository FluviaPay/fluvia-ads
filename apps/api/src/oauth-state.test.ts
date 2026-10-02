import { describe, expect, it } from 'vitest';
import { toBase64Url, utf8 } from './encoding';
import { newNonce, signState, verifyState } from './oauth-state';

const SECRET = 's'.repeat(40);
const NOW = 1_800_000_000;
const payload = {
  cid: '0b6f6f9e-1c1a-4d5e-9a57-2f2f7b1b0a11',
  nonce: 'n'.repeat(22),
  exp: NOW + 1800,
};

describe('state', () => {
  it('signs and verifies', async () => {
    const state = await signState(SECRET, payload);
    expect(state).toMatch(/^[\w-]+\.[\w-]+$/);
    expect(await verifyState(SECRET, state, NOW)).toEqual({ ok: true, payload });
  });

  it('rejects another secret', async () => {
    const state = await signState(SECRET, payload);
    expect(await verifyState('t'.repeat(40), state, NOW)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('rejects a tampered payload (e.g. swapping the client id) and a tampered signature', async () => {
    const state = await signState(SECRET, payload);
    const [, signature] = state.split('.');
    const forged = toBase64Url(
      utf8(JSON.stringify({ ...payload, cid: '11111111-1111-4111-8111-111111111111' })),
    );
    expect(await verifyState(SECRET, `${forged}.${signature}`, NOW)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
    const [body] = state.split('.');
    expect(await verifyState(SECRET, `${body}.${signature?.slice(0, -2)}AA`, NOW)).toMatchObject({
      ok: false,
    });
  });

  it('rejects an expired state, even with a valid signature', async () => {
    const state = await signState(SECRET, payload);
    expect(await verifyState(SECRET, state, payload.exp)).toEqual({ ok: false, reason: 'expired' });
    expect(await verifyState(SECRET, state, payload.exp + 1)).toEqual({
      ok: false,
      reason: 'expired',
    });
    expect(await verifyState(SECRET, state, payload.exp - 1)).toMatchObject({ ok: true });
  });

  it.each(['', 'abc', 'a.b.c', '.', 'a.', '.b', '***.***'])(
    'rejects the malformed state %j',
    async (state) => {
      expect(await verifyState(SECRET, state, NOW)).toMatchObject({ ok: false });
    },
  );

  it('rejects a correctly signed payload with the wrong shape', async () => {
    for (const bad of [
      { cid: 'not-a-uuid', nonce: payload.nonce, exp: payload.exp },
      { cid: payload.cid },
    ]) {
      const state = await signState(SECRET, bad as typeof payload);
      expect(await verifyState(SECRET, state, NOW)).toEqual({ ok: false, reason: 'malformed' });
    }
  });

  it('generates unpredictable nonces', () => {
    const nonces = new Set(Array.from({ length: 50 }, newNonce));
    expect(nonces.size).toBe(50);
    expect([...nonces][0]?.length).toBeGreaterThanOrEqual(16);
  });
});
