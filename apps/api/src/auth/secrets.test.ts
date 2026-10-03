import { describe, expect, it } from 'vitest';
import {
  hmacHex,
  normalizeRecoveryCode,
  randomCode,
  randomRecoveryCode,
  randomToken,
  sha256Hex,
} from './secrets';

describe('secrets', () => {
  it('generates 6-digit codes with all digits possible', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const code = randomCode();
      expect(code).toMatch(/^\d{6}$/);
      seen.add(code);
    }
    expect(seen.size).toBeGreaterThan(290);
  });

  it('generates unique 256-bit tokens', () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(a);
  });

  it('hashes deterministically; the HMAC depends on the key', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(await hmacHex('k1', '123456')).toBe(await hmacHex('k1', '123456'));
    expect(await hmacHex('k1', '123456')).not.toBe(await hmacHex('k2', '123456'));
    expect(await hmacHex('k1', '123456')).not.toBe(await hmacHex('k1', '123457'));
  });

  it('formats and normalizes recovery codes', () => {
    const code = randomRecoveryCode();
    expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    expect(normalizeRecoveryCode(` ${code.toLowerCase()} `)).toBe(code.replace('-', ''));
  });
});
