import { toBase64Url, utf8 } from '../encoding';

const hex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(value: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', utf8(value)));
}

/** Keyed hash for low-entropy secrets (6-digit codes): a database leak alone cannot brute-force them. */
export async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    utf8(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return hex(await crypto.subtle.sign('HMAC', key, utf8(value)));
}

/** Uniform 6-digit code (rejection sampling, no modulo bias). */
export function randomCode(): string {
  const limit = 4_294_967_296 - (4_294_967_296 % 1_000_000);
  const buffer = new Uint32Array(1);
  do crypto.getRandomValues(buffer);
  while ((buffer[0] ?? 0) >= limit);
  return String((buffer[0] ?? 0) % 1_000_000).padStart(6, '0');
}

/** 256 bits of randomness; this is what the cookie carries. */
export function randomToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** `XXXXX-XXXXX`, 50 bits; one-time use. */
export function randomRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const chars = [...bytes].map((b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join('');
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

export const normalizeRecoveryCode = (value: string): string =>
  value.replace(/[\s-]/g, '').toUpperCase();
