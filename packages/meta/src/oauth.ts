import { z } from 'zod';
import type { MetaClient } from './client';
import { parseBody } from './operations/parse';
import { META_GRAPH_VERSION } from './version';

export const FACEBOOK_DIALOG_BASE = 'https://www.facebook.com';

export type LoginUrlInput = {
  appId: string;
  /** Facebook Login for Business configuration id (carries the permissions). */
  configId: string;
  /** Must match, character for character, the URI registered in the Meta app. */
  redirectUri: string;
  state: string;
};

/**
 * 🔶 Login for Business dialog URL. Parameter names are UNCONFIRMED against Meta's docs
 * (docs/plan-meta.md §6, point 2); verify before the first real login.
 */
export function buildLoginUrl(input: LoginUrlInput): string {
  const url = new URL(`${FACEBOOK_DIALOG_BASE}/${META_GRAPH_VERSION}/dialog/oauth`);
  url.searchParams.set('client_id', input.appId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('state', input.state);
  url.searchParams.set('config_id', input.configId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('override_default_response_type', 'true');
  return url.toString();
}

export type TokenExchange = {
  accessToken: string;
  tokenType: string | undefined;
  /** Seconds until it expires, when Meta says so. */
  expiresInSec: number | undefined;
};

const tokenSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  expires_in: z.number().optional(),
});

/**
 * 🔶 Exchanges the dialog's `code` for a user token. Uses the app credentials, not the
 * system user token. Whether Login for Business returns a long-lived token here, or needs
 * a second exchange, is UNCONFIRMED: the expiry Meta reports is passed through as is.
 */
export async function exchangeCodeForToken(
  client: MetaClient,
  input: { appId: string; appSecret: string; redirectUri: string; code: string },
): Promise<TokenExchange> {
  const res = await client.get(
    '/oauth/access_token',
    {
      client_id: input.appId,
      client_secret: input.appSecret,
      redirect_uri: input.redirectUri,
      code: input.code,
    },
    { auth: 'none' },
  );
  const body = parseBody(tokenSchema, res.body, 'exchangeCodeForToken');
  return {
    accessToken: body.access_token,
    tokenType: body.token_type,
    expiresInSec: body.expires_in,
  };
}
