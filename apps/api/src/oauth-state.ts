import { z } from 'zod';
import { fromBase64, toBase64Url, utf8 } from './encoding';

export const STATE_TTL_SECONDS = 30 * 60;

const payloadSchema = z.object({
  cid: z.uuid(),
  nonce: z.string().min(16).max(64),
  /** Expiry, epoch seconds. */
  exp: z.int(),
});
export type StatePayload = z.infer<typeof payloadSchema>;

export type StateVerification =
  | { ok: true; payload: StatePayload }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' };

export function newNonce(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
}

const hmacKey = (secret: string, usages: ('sign' | 'verify')[]) =>
  crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usages);

/** `<payload>.<signature>`, both base64url; HMAC-SHA256 over the payload part. */
export async function signState(secret: string, payload: StatePayload): Promise<string> {
  const body = toBase64Url(utf8(JSON.stringify(payload)));
  const key = await hmacKey(secret, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, utf8(body));
  return `${body}.${toBase64Url(new Uint8Array(signature))}`;
}

/** Checks the signature first (constant time) and only then looks inside the payload. */
export async function verifyState(
  secret: string,
  state: string,
  nowSeconds: number,
): Promise<StateVerification> {
  const parts = state.split('.');
  const [body, signature] = parts;
  const signatureBytes = signature ? fromBase64(signature) : null;
  if (parts.length !== 2 || !body || !signatureBytes) return { ok: false, reason: 'malformed' };

  const key = await hmacKey(secret, ['verify']);
  const valid = await crypto.subtle.verify('HMAC', key, signatureBytes, utf8(body));
  if (!valid) return { ok: false, reason: 'bad_signature' };

  const bodyBytes = fromBase64(body);
  let parsed: unknown;
  try {
    parsed = bodyBytes ? JSON.parse(new TextDecoder().decode(bodyBytes)) : null;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const payload = payloadSchema.safeParse(parsed);
  if (!payload.success) return { ok: false, reason: 'malformed' };
  if (payload.data.exp <= nowSeconds) return { ok: false, reason: 'expired' };
  return { ok: true, payload: payload.data };
}
