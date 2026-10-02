import { expect, it } from 'vitest';
import { fromBase64, safeEqual, toBase64Url, utf8 } from './encoding';

it('base64url round-trips arbitrary bytes and never uses + / =', () => {
  const bytes = new Uint8Array([251, 255, 254, 0, 1, 62, 63]);
  const encoded = toBase64Url(bytes);
  expect(encoded).not.toMatch(/[+/=]/);
  expect(Array.from(fromBase64(encoded) ?? [])).toEqual(Array.from(bytes));
});

it('fromBase64 accepts standard base64 and returns null on garbage', () => {
  expect(Array.from(fromBase64('+/8=') ?? [])).toEqual([251, 255]);
  expect(fromBase64('***')).toBeNull();
});

it('safeEqual compares strings, whatever their length', async () => {
  expect(await safeEqual('secret', 'secret')).toBe(true);
  expect(await safeEqual('secret', 'secreT')).toBe(false);
  expect(await safeEqual('secret', 'secret-and-more')).toBe(false);
  expect(await safeEqual('', 'x')).toBe(false);
  expect(utf8('ñ').length).toBe(2);
});
