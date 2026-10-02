import {
  MetaApiError,
  buildLoginUrl,
  checkPagePermissions,
  exchangeCodeForToken,
  getGrantedPermissions,
  getInstagramAccount,
  getPages,
  type MetaClient,
} from '@fluvia/meta';
import {
  encodeConnectResult,
  type ConnectReason,
  type ConnectResult,
  type ConnectionReceivedEvent,
} from '@fluvia/shared';
import { encryptToken } from '../crypto';
import type { EventPublisher } from '../events';
import { log } from '../logger';
import { STATE_TTL_SECONDS, newNonce, signState, verifyState } from '../oauth-state';
import type { ConnectConfig } from './config';
import type { ConnectionStore, RetryLink } from './store';
import { buildTask } from './task-catalog';

export type ConnectDeps = {
  config: ConnectConfig;
  store: ConnectionStore;
  /** A Meta client; with a token it calls on behalf of that user (the client's own token). */
  meta: (userToken?: string) => MetaClient;
  now: () => Date;
  events: EventPublisher;
  newId: () => string;
  requestId?: string;
};

const tokenAad = (clientId: string) => `meta_connections:${clientId}`;

async function issueState(deps: ConnectDeps, clientId: string) {
  const expiresAt = new Date(deps.now().getTime() + STATE_TTL_SECONDS * 1000);
  const nonce = newNonce();
  const state = await signState(deps.config.stateSecret, {
    cid: clientId,
    nonce,
    exp: Math.floor(expiresAt.getTime() / 1000),
  });
  return { state, nonce, expiresAt };
}

/** The URL of the web landing page that carries the signed state. Null: unknown client. */
export async function createConnectionLink(
  deps: ConnectDeps,
  clientId: string,
): Promise<{ url: string; expiresAt: Date } | null> {
  if (!(await deps.store.clientExists(clientId))) return null;
  const { state, nonce, expiresAt } = await issueState(deps, clientId);
  await deps.store.createLink({ clientId, nonce, expiresAt });
  return {
    url: `${deps.config.webBaseUrl}/connect?state=${encodeURIComponent(state)}`,
    expiresAt,
  };
}

export type LoginStart = { ok: true; redirectTo: string } | { ok: false };

/**
 * Checks signature and expiry only (the nonce is consumed by the callback), then sends the
 * browser to Facebook. In mock mode it skips Facebook and goes straight to our callback.
 */
export async function startLogin(deps: ConnectDeps, state: string): Promise<LoginStart> {
  const verified = await verifyState(
    deps.config.stateSecret,
    state,
    Math.floor(deps.now().getTime() / 1000),
  );
  if (!verified.ok) return { ok: false };

  if (deps.config.mode === 'mock') {
    const callback = new URL(deps.config.redirectUri);
    callback.searchParams.set('code', 'mock_code');
    callback.searchParams.set('state', state);
    return { ok: true, redirectTo: callback.toString() };
  }
  return {
    ok: true,
    redirectTo: buildLoginUrl({
      appId: deps.config.appId,
      configId: deps.config.loginConfigId,
      redirectUri: deps.config.redirectUri,
      state,
    }),
  };
}

export function resultUrl(config: ConnectConfig, result: ConnectResult): string {
  return `${config.webBaseUrl}/connect/result?${encodeConnectResult(result)}`;
}

/** Category and code only: Meta's message could carry personal data. */
function describeFailure(step: string, err: unknown): string {
  if (err instanceof MetaApiError) return `${step}:${err.category}:${err.code ?? err.status}`;
  return `${step}:${err instanceof Error ? err.name : 'unknown'}`;
}

export type CallbackParams = {
  state?: string | undefined;
  code?: string | undefined;
  error?: string | undefined;
};

/**
 * Processes Facebook's redirect. Every path ends in a ConnectResult the web can show;
 * nothing here throws for something a client or Meta can cause.
 */
export async function handleCallback(
  deps: ConnectDeps,
  params: CallbackParams,
): Promise<ConnectResult> {
  const { config, store } = deps;
  const invalid: ConnectResult = { status: 'invalid_state', reasons: [] };

  const verified = params.state
    ? await verifyState(config.stateSecret, params.state, Math.floor(deps.now().getTime() / 1000))
    : ({ ok: false, reason: 'malformed' } as const);
  if (!verified.ok) {
    // Without a valid signature the client id cannot be trusted, so there is no audit row.
    log('warn', 'meta_callback_state_rejected', {
      request_id: deps.requestId,
      reason: verified.reason,
    });
    return invalid;
  }

  const { cid: clientId, nonce } = verified.payload;
  if (!(await store.consumeNonce({ clientId, nonce, now: deps.now() }))) {
    await store.recordOutcome({ kind: 'rejected', clientId, reason: 'reused_or_expired' });
    return invalid;
  }

  const retryLink = async (): Promise<{ link: RetryLink; state: string }> => {
    const issued = await issueState(deps, clientId);
    return { link: { nonce: issued.nonce, expiresAt: issued.expiresAt }, state: issued.state };
  };

  const finish = async (
    kind: 'cancelled' | 'failed',
    result: Pick<ConnectResult, 'status'>,
    reason: string,
  ): Promise<ConnectResult> => {
    const { link, state } = await retryLink();
    await store.recordOutcome(
      kind === 'cancelled'
        ? { kind, clientId, retry: link }
        : { kind, clientId, reason, retry: link },
    );
    return { status: result.status, reasons: [], retryState: state };
  };

  if (params.error) return finish('cancelled', { status: 'cancelled' }, params.error);
  if (!params.code) return finish('failed', { status: 'error' }, 'missing_code');

  let accessToken: string;
  let expiresInSec: number | undefined;
  try {
    const exchange = await exchangeCodeForToken(deps.meta(), {
      appId: config.appId,
      appSecret: config.appSecret,
      redirectUri: config.redirectUri,
      code: params.code,
    });
    accessToken = exchange.accessToken;
    expiresInSec = exchange.expiresInSec;
  } catch (err) {
    return finish('failed', { status: 'error' }, describeFailure('token_exchange', err));
  }

  let pageId: string | null = null;
  let igId: string | null = null;
  let permissions: string[];
  const reasons: ConnectReason[] = [];
  try {
    const user = deps.meta(accessToken);
    const pages = await getPages(user);
    if (pages.length === 1 && pages[0]) {
      const page = pages[0];
      pageId = page.id;
      const check = await checkPagePermissions(user, page.id);
      permissions = check.grantedPermissions;
      reasons.push(...check.failures.map((f) => f.code));
      igId = (await getInstagramAccount(user, page.id))?.id ?? null;
    } else {
      permissions = await getGrantedPermissions(user);
      reasons.push(pages.length === 0 ? 'NO_PAGE' : 'MULTIPLE_PAGES');
    }
  } catch (err) {
    return finish('failed', { status: 'error' }, describeFailure('meta_read', err));
  }

  let encryptedToken: string;
  try {
    encryptedToken = await encryptToken(config.tokenKey, accessToken, tokenAad(clientId));
  } catch (err) {
    return finish('failed', { status: 'error' }, describeFailure('encrypt', err));
  }

  const ok = reasons.length === 0;
  const retry = ok ? null : await retryLink();
  await store.recordOutcome({
    kind: 'saved',
    clientId,
    status: ok ? 'pending' : 'needs_action',
    pageId,
    igId,
    permissions,
    reasons,
    encryptedToken,
    tokenExpiresAt:
      expiresInSec === undefined ? null : new Date(deps.now().getTime() + expiresInSec * 1000),
    retry: retry?.link ?? null,
  });

  // Saved and fine: the next step (validate, create the ad account) runs from the queue.
  if (ok) await publishReceived(deps, clientId);

  return ok
    ? { status: 'ok', reasons: [] }
    : { status: 'needs_action', reasons, retryState: retry?.state };
}

/** Tells the queue to process this client's connection. Never makes the client's page fail. */
export async function publishReceived(
  deps: ConnectDeps,
  clientId: string,
  acknowledged: ConnectionReceivedEvent['acknowledged'] = [],
): Promise<void> {
  try {
    await deps.events.publish({
      id: deps.newId(),
      type: 'meta.connection.received',
      occurredAt: deps.now().toISOString(),
      clientId,
      acknowledged,
    });
  } catch (err) {
    log('error', 'meta_connection_enqueue_failed', {
      request_id: deps.requestId,
      client_id: clientId,
      error: err instanceof Error ? err.name : 'unknown',
    });
    try {
      await deps.store.recordEnqueueFailure({
        clientId,
        task: buildTask('ENQUEUE_FAILED', { clientId }),
      });
    } catch {
      // Nothing else to do: the error is already logged with the client id.
    }
  }
}
