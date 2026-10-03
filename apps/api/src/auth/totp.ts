/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s), the profile every authenticator app supports. */
export const TOTP_STEP_SECONDS = 30;
const DIGITS = 6;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Uint8Array | null {
  const clean = text.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** 160 random bits, the size RFC 4226 recommends. */
export function generateTotpSecret(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

export const totpStep = (now: Date): number => Math.floor(now.getTime() / 1000 / TOTP_STEP_SECONDS);

export async function hotp(secretBase32: string, counter: number): Promise<string> {
  const secret = base32Decode(secretBase32);
  if (!secret) throw new Error('Invalid TOTP secret');
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-1' }, false, [
    'sign',
  ]);
  const message = new Uint8Array(8);
  new DataView(message.buffer).setBigUint64(0, BigInt(counter));
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, message));
  const offset = (mac[19] ?? 0) & 15;
  const binary =
    (((mac[offset] ?? 0) & 127) << 24) |
    ((mac[offset + 1] ?? 0) << 16) |
    ((mac[offset + 2] ?? 0) << 8) |
    (mac[offset + 3] ?? 0);
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * Accepts the current step and one step either side (clock drift). Returns the matched step so
 * the caller can store it and refuse the same code twice, or null if nothing matched.
 * `afterStep` is the last accepted step: anything at or before it is a replay.
 */
export async function verifyTotp(
  secretBase32: string,
  code: string,
  now: Date,
  afterStep: number | null,
): Promise<number | null> {
  if (!/^\d{6}$/.test(code)) return null;
  const current = totpStep(now);
  let matched: number | null = null;
  // Check all three windows without early exit, so timing does not reveal which one matched.
  for (const step of [current - 1, current, current + 1]) {
    const expected = await hotp(secretBase32, step);
    let diff = 0;
    for (let i = 0; i < DIGITS; i++) diff |= expected.charCodeAt(i) ^ code.charCodeAt(i);
    if (diff === 0 && (afterStep === null || step > afterStep)) matched = step;
  }
  return matched;
}

export function otpauthUri(params: { secret: string; email: string; issuer: string }): string {
  const label = encodeURIComponent(`${params.issuer}:${params.email}`);
  const query = new URLSearchParams({
    secret: params.secret,
    issuer: params.issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}
