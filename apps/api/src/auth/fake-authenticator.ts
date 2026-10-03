import { fromBase64, toBase64Url, utf8 } from '../encoding';

/**
 * A software passkey for tests: a real P-256 key pair that builds the same bytes a browser
 * and authenticator would send (CBOR attestation, DER signature), so the server's
 * verification runs for real instead of being mocked.
 */

// ---- minimal CBOR (only what a "none" attestation and a COSE key need) ----------------
const head = (major: number, value: number): number[] => {
  if (value < 24) return [(major << 5) | value];
  if (value < 256) return [(major << 5) | 24, value];
  return [(major << 5) | 25, value >> 8, value & 255];
};
type Cbor = number | string | Uint8Array | Cbor[] | Map<number | string, Cbor>;
function cbor(value: Cbor): number[] {
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === 'string') return [...head(3, utf8(value).length), ...utf8(value)];
  if (value instanceof Uint8Array) return [...head(2, value.length), ...value];
  if (value instanceof Map) {
    return [...head(5, value.size), ...[...value].flatMap(([k, v]) => [...cbor(k), ...cbor(v)])];
  }
  return [...head(4, value.length), ...value.flatMap(cbor)];
}

const sha256 = async (data: Uint8Array) =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource));
const concat = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((p) => [...p]));
const be32 = (n: number) => new Uint8Array([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);

/** WebCrypto gives r||s; WebAuthn wants ASN.1 DER. */
function rawToDer(raw: Uint8Array): Uint8Array {
  const int = (bytes: Uint8Array) => {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i++;
    const trimmed = bytes.slice(i);
    const body = (trimmed[0] ?? 0) & 0x80 ? concat(new Uint8Array([0]), trimmed) : trimmed;
    return concat(new Uint8Array([0x02, body.length]), body);
  };
  const seq = concat(int(raw.slice(0, 32)), int(raw.slice(32)));
  return concat(new Uint8Array([0x30, seq.length]), seq);
}

export type FakeOptions = {
  rpId: string;
  origin: string;
  /** Opaque user handle the passkey was created for (the staff id). */
  userHandle?: string;
};

export type Tamper = {
  origin?: string;
  rpId?: string;
  challenge?: string;
  userVerified?: boolean;
  counter?: number;
};

export async function createFakeAuthenticator(config: FakeOptions) {
  const keys = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', keys.publicKey)) as JsonWebKey;
  const x = fromBase64(jwk.x ?? '') ?? new Uint8Array();
  const y = fromBase64(jwk.y ?? '') ?? new Uint8Array();
  const credentialId = crypto.getRandomValues(new Uint8Array(32));
  const idB64 = toBase64Url(credentialId);
  let counter = 0;

  const clientData = (type: string, challenge: string, origin: string) =>
    utf8(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  const flags = (verified: boolean, attested: boolean) =>
    0x01 | (verified ? 0x04 : 0) | (attested ? 0x40 : 0);

  return {
    credentialId: idB64,
    get counter() {
      return counter;
    },

    async register(options: { challenge: string; user: { id: string } }, tamper: Tamper = {}) {
      const rpHash = await sha256(utf8(tamper.rpId ?? config.rpId));
      const cose = cbor(
        new Map<number, Cbor>([
          [1, 2],
          [3, -7],
          [-1, 1],
          [-2, x],
          [-3, y],
        ]),
      );
      const authData = concat(
        rpHash,
        new Uint8Array([flags(tamper.userVerified ?? true, true)]),
        be32(tamper.counter ?? counter),
        new Uint8Array(16),
        new Uint8Array([credentialId.length >> 8, credentialId.length & 255]),
        credentialId,
        new Uint8Array(cose),
      );
      const attestation = new Uint8Array(
        cbor(
          new Map<string, Cbor>([
            ['fmt', 'none'],
            ['attStmt', new Map()],
            ['authData', authData],
          ]),
        ),
      );
      return {
        id: idB64,
        rawId: idB64,
        type: 'public-key' as const,
        response: {
          clientDataJSON: toBase64Url(
            clientData(
              'webauthn.create',
              tamper.challenge ?? options.challenge,
              tamper.origin ?? config.origin,
            ),
          ),
          attestationObject: toBase64Url(attestation),
          transports: ['internal'],
        },
        clientExtensionResults: {},
        authenticatorAttachment: 'platform',
      };
    },

    async authenticate(options: { challenge: string }, tamper: Tamper = {}) {
      counter = tamper.counter ?? counter + 1;
      const authData = concat(
        await sha256(utf8(tamper.rpId ?? config.rpId)),
        new Uint8Array([flags(tamper.userVerified ?? true, false)]),
        be32(counter),
      );
      const data = clientData(
        'webauthn.get',
        tamper.challenge ?? options.challenge,
        tamper.origin ?? config.origin,
      );
      const signed = concat(authData, await sha256(data));
      const raw = new Uint8Array(
        await crypto.subtle.sign(
          { name: 'ECDSA', hash: 'SHA-256' },
          keys.privateKey,
          signed as BufferSource,
        ),
      );
      return {
        id: idB64,
        rawId: idB64,
        type: 'public-key' as const,
        response: {
          clientDataJSON: toBase64Url(data),
          authenticatorData: toBase64Url(authData),
          signature: toBase64Url(rawToDer(raw)),
          ...(config.userHandle ? { userHandle: toBase64Url(utf8(config.userHandle)) } : {}),
        },
        clientExtensionResults: {},
        authenticatorAttachment: 'platform',
      };
    },
  };
}
