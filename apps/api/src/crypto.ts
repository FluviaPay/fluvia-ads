import { fromBase64, toBase64Url, utf8 } from './encoding';

const VERSION = 'v1';
const IV_BYTES = 12;

export class TokenCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenCryptoError';
  }
}

async function importKey(keyBase64: string): Promise<CryptoKey> {
  const raw = fromBase64(keyBase64);
  if (!raw || raw.length !== 32) {
    throw new TokenCryptoError('TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 encoded');
  }
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/**
 * AES-256-GCM with a fresh random IV per call. Output: `v1.<iv>.<ciphertext+tag>` (base64url).
 * `aad` (e.g. `meta_connections:<client_id>`) is authenticated but not stored, so a
 * ciphertext copied to another row cannot be decrypted there. The `v1` prefix leaves room
 * for key rotation.
 */
export async function encryptToken(
  keyBase64: string,
  plaintext: string,
  aad: string,
): Promise<string> {
  const key = await importKey(keyBase64);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: utf8(aad) },
    key,
    utf8(plaintext),
  );
  return `${VERSION}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
}

export async function decryptToken(
  keyBase64: string,
  payload: string,
  aad: string,
): Promise<string> {
  const [version, ivPart, dataPart, ...rest] = payload.split('.');
  const iv = ivPart ? fromBase64(ivPart) : null;
  const data = dataPart ? fromBase64(dataPart) : null;
  if (version !== VERSION || rest.length > 0 || !iv || !data) {
    throw new TokenCryptoError('Unsupported encrypted token format');
  }
  const key = await importKey(keyBase64);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: utf8(aad) },
      key,
      data,
    );
    return new TextDecoder().decode(plain);
  } catch {
    // Wrong key, wrong aad or tampered data: indistinguishable on purpose.
    throw new TokenCryptoError('Could not decrypt the token');
  }
}
