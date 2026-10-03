import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, hotp, otpauthUri, verifyTotp } from './totp';

// RFC 6238 appendix B: the ASCII secret "12345678901234567890".
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('totp', () => {
  it('matches the RFC 6238 test vectors (last 6 digits)', async () => {
    expect(await hotp(RFC_SECRET, 1)).toBe('287082'); // t = 59
    expect(await hotp(RFC_SECRET, 37037036)).toBe('081804'); // t = 1111111080
    expect(await hotp(RFC_SECRET, 37037037)).toBe('050471'); // t = 1111111110
  });

  it('round-trips base32 and rejects bad input', () => {
    const bytes = new Uint8Array([1, 2, 3, 250, 251, 252, 0, 9]);
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    expect(base32Decode('not*base32')).toBeNull();
  });

  it('accepts one step of drift and no more', async () => {
    const now = new Date(59_000);
    expect(await verifyTotp(RFC_SECRET, '287082', now, null)).toBe(1);
    expect(await verifyTotp(RFC_SECRET, '287082', new Date(89_000), null)).toBe(1); // +1 step
    expect(await verifyTotp(RFC_SECRET, '287082', new Date(119_000), null)).toBeNull(); // +2 steps
  });

  it('refuses a replayed code', async () => {
    const now = new Date(59_000);
    expect(await verifyTotp(RFC_SECRET, '287082', now, 1)).toBeNull();
    expect(await verifyTotp(RFC_SECRET, '287082', now, 0)).toBe(1);
  });

  it('rejects malformed codes', async () => {
    const now = new Date(59_000);
    for (const bad of ['', '12345', '1234567', 'abcdef', '287 082']) {
      expect(await verifyTotp(RFC_SECRET, bad, now, null)).toBeNull();
    }
  });

  it('builds the otpauth URI for the authenticator app', () => {
    const uri = otpauthUri({ secret: 'ABC', email: 'a@b.co', issuer: 'Fluvia Ads' });
    expect(uri).toContain('otpauth://totp/Fluvia%20Ads%3Aa%40b.co?');
    expect(uri).toContain('secret=ABC');
    expect(uri).toContain('issuer=Fluvia+Ads');
  });
});
