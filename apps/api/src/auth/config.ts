import { fromBase64 } from '../encoding';
import type { Bindings } from '../env';
import { NotConfiguredError } from '../meta/config';

export type AuthConfig = {
  /** HMAC key for login codes and recovery codes. */
  authSecret: string;
  /** AES-256 key (base64) that encrypts TOTP secrets: the same one as for Meta tokens. */
  tokenKey: string;
  webOrigin: string;
  secureCookies: boolean;
  emailFrom: string;
  resendApiKey: string | undefined;
  issuer: string;
  webauthn: { rpId: string; rpName: string; origin: string };
};

export const AUTH_LIMITS = {
  codeTtlMinutes: 10,
  maxCodeAttempts: 5,
  /** Codes that may be requested for one person in a window. */
  maxCodesPerHour: 5,
  /** Wrong second-factor tries before the session is killed. */
  maxMfaAttempts: 5,
  idleTimeoutMinutes: 120,
  absoluteTimeoutHours: 12,
  /** The half-logged-in session (email verified, TOTP pending) is short. */
  pendingMfaMinutes: 15,
  challengeMinutes: 5,
  ipLoginPerMinute: 10,
  ipVerifyPerMinute: 10,
} as const;

const blank = (value: string | undefined) => value?.trim() || undefined;

export function resolveAuthConfig(env: Bindings): AuthConfig {
  const missing: string[] = [];
  const secret = blank(env.AUTH_SECRET);
  if (!secret || secret.length < 32) missing.push('AUTH_SECRET');
  const key = blank(env.TOKEN_ENCRYPTION_KEY);
  if (!key || fromBase64(key)?.length !== 32) missing.push('TOKEN_ENCRYPTION_KEY');
  const web = blank(env.WEB_BASE_URL)?.replace(/\/+$/, '');
  if (!web) missing.push('WEB_BASE_URL');
  const from = blank(env.EMAIL_FROM);
  if (!from) missing.push('EMAIL_FROM');
  const resend = blank(env.RESEND_API_KEY);
  // Only development may run without an email provider (the code goes to the log).
  if (!resend && env.ENVIRONMENT !== 'development') missing.push('RESEND_API_KEY');

  if (missing.length > 0 || !secret || !key || !web || !from) {
    throw new NotConfiguredError(missing);
  }
  const origin = new URL(web).origin;
  const hostname = new URL(web).hostname;
  const rpId = blank(env.WEBAUTHN_RP_ID) ?? hostname;
  // The RP ID must be the web host or a parent domain of it, or browsers refuse the passkey.
  if (hostname !== rpId && !hostname.endsWith(`.${rpId}`)) {
    throw new NotConfiguredError(['WEBAUTHN_RP_ID']);
  }
  return {
    authSecret: secret,
    tokenKey: key,
    webOrigin: origin,
    secureCookies: web.startsWith('https://'),
    emailFrom: from,
    resendApiKey: resend,
    issuer: 'Fluvia Ads',
    webauthn: { rpId, rpName: 'Fluvia Ads', origin },
  };
}
