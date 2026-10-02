import { describe, expect, it } from 'vitest';
import { toBase64Url } from './encoding';
import { TokenCryptoError, decryptToken, encryptToken } from './crypto';

const key = (fill: number) => btoa(String.fromCharCode(...new Uint8Array(32).fill(fill)));
const KEY = key(7);
const TOKEN = 'EAAFAKE-user-token-with-secret-material';
const AAD = 'meta_connections:0b6f6f9e-1c1a-4d5e-9a57-2f2f7b1b0a11';

describe('encryptToken / decryptToken', () => {
  it('round-trips', async () => {
    expect(await decryptToken(KEY, await encryptToken(KEY, TOKEN, AAD), AAD)).toBe(TOKEN);
  });

  it('produces v1.<iv>.<data> and never contains the plaintext', async () => {
    const payload = await encryptToken(KEY, TOKEN, AAD);
    expect(payload).toMatch(/^v1\.[\w-]+\.[\w-]+$/);
    expect(payload).not.toContain(TOKEN);
    expect(payload).not.toContain(toBase64Url(new TextEncoder().encode(TOKEN)));
  });

  it('uses a fresh IV every time, so equal tokens never look equal', async () => {
    const [a, b] = await Promise.all([
      encryptToken(KEY, TOKEN, AAD),
      encryptToken(KEY, TOKEN, AAD),
    ]);
    expect(a).not.toBe(b);
  });

  it('refuses a different key', async () => {
    const payload = await encryptToken(KEY, TOKEN, AAD);
    await expect(decryptToken(key(8), payload, AAD)).rejects.toBeInstanceOf(TokenCryptoError);
  });

  it('refuses a ciphertext moved to another row (different aad)', async () => {
    const payload = await encryptToken(KEY, TOKEN, AAD);
    await expect(decryptToken(KEY, payload, 'meta_connections:other')).rejects.toBeInstanceOf(
      TokenCryptoError,
    );
  });

  it('refuses tampered data', async () => {
    const [v, iv, data] = (await encryptToken(KEY, TOKEN, AAD)).split('.');
    const flipped = `${data?.slice(0, -2)}${data?.endsWith('AA') ? 'BB' : 'AA'}`;
    await expect(decryptToken(KEY, `${v}.${iv}.${flipped}`, AAD)).rejects.toBeInstanceOf(
      TokenCryptoError,
    );
  });

  it.each(['', 'v1', 'v1.a', 'v2.a.b', 'v1.a.b.c', 'not-a-payload'])(
    'refuses the malformed payload %j',
    async (payload) => {
      await expect(decryptToken(KEY, payload, AAD)).rejects.toBeInstanceOf(TokenCryptoError);
    },
  );

  it('requires a 32-byte key', async () => {
    for (const bad of ['', 'short', btoa('x'.repeat(16)), btoa('x'.repeat(33))]) {
      await expect(encryptToken(bad, TOKEN, AAD)).rejects.toThrow(/32 bytes/);
    }
  });
});
