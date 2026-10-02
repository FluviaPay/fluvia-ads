import {
  MetaApiError,
  MetaConflictError,
  MetaNetworkError,
  assignPageToAdAccount,
  createAdAccount,
  probePageRestrictions,
  type MetaClient,
} from '@fluvia/meta';
import { metaConnectedKey, type MetaConnectedEvent } from '@fluvia/shared';
import { DEFAULT_MESSAGE_DESTINATIONS } from '@fluvia/templates';
import { decryptToken } from '../crypto';
import type { EventPublisher } from '../events';
import { log } from '../logger';
import type { ClientLockPort } from './lock';
import type { SetupConfigResult } from './setup-config';
import type { SetupContext, SetupStore } from './setup-store';
import { buildTask, type SetupTaskCode, type TaskContext } from './task-catalog';
import { validateConnection, type MessageDestination, type SetupFailure } from './validate';

export const MAX_ATTEMPTS = 6;
const LOCK_RETRY_SECONDS = 60;
const MAX_DELAY_SECONDS = 900;

export type PipelineDeps = {
  store: SetupStore;
  /** Without a token: Fluvia's system user. With one: that client's own token. */
  meta: (userToken?: string) => MetaClient;
  lock: ClientLockPort;
  events: EventPublisher;
  setup: SetupConfigResult;
  tokenKey: string;
  /** Used as the link of the validation-only creative. */
  webBaseUrl: string;
  now: () => Date;
  newId: () => string;
  requestId?: string | undefined;
};

export type PipelineInput = {
  clientId: string;
  /** Codes a person verified by hand (see acknowledgeableCodeSchema). */
  acknowledged: ReadonlySet<string>;
  /** Queue delivery attempt, starting at 1. */
  attempt: number;
  maxAttempts?: number;
};

export type PipelineResult =
  | { kind: 'connected' }
  | { kind: 'needs_action'; codes: SetupTaskCode[] }
  | { kind: 'retry'; delaySeconds: number; reason: string }
  | { kind: 'skipped'; reason: string };

type Stage = 'validate' | 'create' | 'assign' | 'probe';

type Decision =
  { action: 'retry'; delaySeconds: number } | { action: 'task'; failure: SetupFailure };

const backoffSeconds = (attempt: number) => Math.min(MAX_DELAY_SECONDS, 30 * 2 ** (attempt - 1));

/** What to do with an error from Meta (docs/plan-meta.md §10 and §11). Details: step + category + code. */
export function classifyFailure(
  stage: Stage,
  err: unknown,
  attempt: number,
  maxAttempts: number,
): Decision {
  const exhausted = attempt >= maxAttempts;
  const technical = (detail: string): Decision => ({
    action: 'task',
    failure: { code: 'SETUP_FAILED_TECHNICAL', detail },
  });

  if (err instanceof MetaConflictError) {
    return { action: 'task', failure: { code: 'AD_ACCOUNT_CONFLICT' } };
  }

  if (err instanceof MetaNetworkError) {
    return exhausted
      ? technical(`${stage}:retries_exhausted:network`)
      : { action: 'retry', delaySeconds: backoffSeconds(attempt) };
  }

  if (err instanceof MetaApiError) {
    const detail = `${stage}:${err.category}:${err.code ?? err.status}`;
    switch (err.category) {
      case 'rate_limited': {
        if (exhausted) return technical(`${stage}:retries_exhausted:rate_limited`);
        const wait = Math.ceil((err.retryAfterMs ?? 60_000) / 1000);
        return { action: 'retry', delaySeconds: Math.min(Math.max(wait, 30), MAX_DELAY_SECONDS) };
      }
      case 'transient':
        return exhausted
          ? technical(`${stage}:retries_exhausted:transient`)
          : { action: 'retry', delaySeconds: backoffSeconds(attempt) };
      case 'auth':
        // The client's token is the one that can expire; a rejected system token is ours.
        return stage === 'validate'
          ? { action: 'task', failure: { code: 'AUTH_EXPIRED', detail } }
          : technical(detail);
      case 'permission':
      case 'invalid_request':
      case 'policy':
        return stage === 'create'
          ? { action: 'task', failure: { code: 'AD_ACCOUNT_CREATION_FAILED', detail } }
          : technical(detail);
      default:
        return technical(detail);
    }
  }

  return technical(`${stage}:${err instanceof Error ? err.name : 'unknown'}`);
}

/** Runs the setup of one client under that client's lock. Safe to run twice. */
export async function processConnection(
  deps: PipelineDeps,
  input: PipelineInput,
): Promise<PipelineResult> {
  const maxAttempts = input.maxAttempts ?? MAX_ATTEMPTS;
  const lease = await deps.lock.acquire(input.clientId);
  if (!lease) {
    if (input.attempt >= maxAttempts) {
      log('error', 'meta_setup_lock_busy', {
        request_id: deps.requestId,
        client_id: input.clientId,
      });
      return { kind: 'skipped', reason: 'lock_busy' };
    }
    return { kind: 'retry', delaySeconds: LOCK_RETRY_SECONDS, reason: 'locked' };
  }
  try {
    return await run(deps, { ...input, maxAttempts });
  } finally {
    await deps.lock.release(input.clientId, lease).catch((err: unknown) => {
      log('error', 'meta_setup_lock_release_failed', {
        request_id: deps.requestId,
        client_id: input.clientId,
        error: err instanceof Error ? err.name : 'unknown',
      });
    });
  }
}

async function run(
  deps: PipelineDeps,
  input: PipelineInput & { maxAttempts: number },
): Promise<PipelineResult> {
  const { clientId } = input;
  const context = await deps.store.getContext(clientId);
  if (!context) return { kind: 'skipped', reason: 'no_connection' };
  const { client, connection } = context;

  if (connection.status === 'revoked') return { kind: 'skipped', reason: 'revoked' };

  const taskContext = (detail?: string): TaskContext => ({
    clientId,
    clientName: client.name,
    whatsapp: client.whatsapp,
    pageId: connection.pageId,
    igId: connection.igId,
    adAccountId: connection.adAccountId,
    detail,
  });

  const needsAction = async (failures: SetupFailure[]): Promise<PipelineResult> => {
    const codes = failures.map((f) => f.code);
    await deps.store.recordNeedsAction({
      clientId,
      codes,
      tasks: failures.map((f) => buildTask(f.code, taskContext(f.detail))),
    });
    log('warn', 'meta_setup_needs_action', {
      request_id: deps.requestId,
      client_id: clientId,
      codes,
    });
    return { kind: 'needs_action', codes };
  };

  /** Runs a Meta step; a failure is either a retry (queue) or a task (human). */
  const guarded = async <T>(
    stage: Stage,
    fn: () => Promise<T>,
  ): Promise<{ ok: true; value: T } | { ok: false; result: PipelineResult }> => {
    try {
      return { ok: true, value: await fn() };
    } catch (err) {
      const decision = classifyFailure(stage, err, input.attempt, input.maxAttempts);
      log('warn', 'meta_setup_step_failed', {
        request_id: deps.requestId,
        client_id: clientId,
        stage,
        action: decision.action,
        error: err instanceof Error ? err.name : 'unknown',
      });
      if (decision.action === 'retry') {
        return {
          ok: false,
          result: { kind: 'retry', delaySeconds: decision.delaySeconds, reason: `${stage}_failed` },
        };
      }
      return { ok: false, result: await needsAction([decision.failure]) };
    }
  };

  // Already done (e.g. a redelivered message): just make sure the next module hears about it.
  if (connection.status === 'connected' && connection.adAccountId && connection.pageId) {
    await publishConnected(deps, {
      clientId,
      adAccountId: connection.adAccountId,
      pageId: connection.pageId,
      igId: connection.igId,
      destinations: connection.messageDestinations,
    });
    return { kind: 'connected' };
  }

  if (input.acknowledged.size > 0) {
    await deps.store.audit({
      actorType: 'human',
      actorId: 'internal-api',
      action: 'meta.setup.acknowledged',
      clientId,
      after: { codes: [...input.acknowledged].sort() },
    });
  }

  if (!connection.pageId || !connection.encryptedToken) {
    return needsAction([{ code: 'RECONNECT_REQUIRED' }]);
  }
  if (connection.tokenExpiresAt && connection.tokenExpiresAt <= deps.now()) {
    return needsAction([{ code: 'AUTH_EXPIRED', detail: 'validate:token_expired' }]);
  }

  let token: string;
  try {
    token = await decryptToken(
      deps.tokenKey,
      connection.encryptedToken,
      `meta_connections:${clientId}`,
    );
  } catch {
    return needsAction([{ code: 'RECONNECT_REQUIRED', detail: 'token_unreadable' }]);
  }

  const destinations = destinationsOf(connection);
  const pageId = connection.pageId;

  // 1. Validations, with the client's own token.
  const validation = await guarded('validate', () =>
    validateConnection(deps.meta(token), { pageId, destinations }),
  );
  if (!validation.ok) return validation.result;
  const failures = validation.value.failures.filter((f) => !input.acknowledged.has(f.code));
  if (failures.length > 0) return needsAction(failures);
  const igId = validation.value.igId;

  if (!deps.setup.ok) {
    return needsAction([{ code: 'CONFIG_MISSING', detail: deps.setup.missing.join(', ') }]);
  }
  const setup = deps.setup.config;
  const system = deps.meta();

  // 2. The ad account (idempotent: it is looked up by name before creating).
  let adAccountId = connection.adAccountId;
  if (!adAccountId) {
    const created = await guarded('create', () =>
      createAdAccount(system, {
        businessId: setup.businessId,
        clientId,
        timezoneId: setup.timezoneId,
        endAdvertiser: setup.endAdvertiser,
        mediaAgency: setup.mediaAgency,
        partner: setup.partner,
      }),
    );
    if (!created.ok) return created.result;
    adAccountId = created.value.id;
    await deps.store.saveAdAccount({ clientId, adAccountId, igId });
    connection.adAccountId = adAccountId;
  }

  // 3. The page. Not repeated once it worked: repeating the request is not known to be safe.
  if (!connection.pageAssignedAt) {
    const manual =
      input.acknowledged.has('PAGE_ASSIGN_MANUAL') ||
      input.acknowledged.has('PAGE_ASSIGN_PENDING_CLIENT');
    if (manual) {
      await deps.store.markPageAssigned({ clientId, how: 'acknowledged', now: deps.now() });
    } else {
      const assigned = await guarded('assign', () =>
        assignPageToAdAccount(system, {
          businessId: setup.businessId,
          pageId,
          adAccountId: adAccountId as string,
          systemUserId: setup.systemUserId,
        }),
      );
      if (!assigned.ok) return assigned.result;
      if (assigned.value.status === 'pending_client_approval') {
        return needsAction([{ code: 'PAGE_ASSIGN_PENDING_CLIENT', detail: assigned.value.reason }]);
      }
      if (assigned.value.status === 'manual_required') {
        return needsAction([{ code: 'PAGE_ASSIGN_MANUAL', detail: assigned.value.reason }]);
      }
      await deps.store.markPageAssigned({ clientId, how: 'api', now: deps.now() });
    }
  }

  // 4. Page restrictions: only checkable now that the account exists and has the page.
  if (!input.acknowledged.has('PAGE_RESTRICTION_UNVERIFIED')) {
    const probe = await guarded('probe', () =>
      probePageRestrictions(system, {
        adAccountId: adAccountId as string,
        pageId,
        link: deps.webBaseUrl,
      }),
    );
    if (!probe.ok) return probe.result;
    if (probe.value.status === 'restricted') {
      return needsAction([
        { code: 'PAGE_RESTRICTED', detail: `probe:policy:${probe.value.code ?? 'unknown'}` },
      ]);
    }
    if (probe.value.status === 'unverified') {
      return needsAction([{ code: 'PAGE_RESTRICTION_UNVERIFIED', detail: probe.value.reason }]);
    }
  }

  // 5. Done: connected, tasks closed, next module notified.
  await deps.store.markConnected({
    clientId,
    adAccountId,
    pageId,
    igId,
    destinations,
    now: deps.now(),
  });
  await publishConnected(deps, { clientId, adAccountId, pageId, igId, destinations });
  return { kind: 'connected' };
}

function destinationsOf(connection: SetupContext['connection']): MessageDestination[] {
  // The capture step will set them; until then the template defaults apply.
  return connection.messageDestinations.length > 0
    ? connection.messageDestinations
    : [...DEFAULT_MESSAGE_DESTINATIONS];
}

async function publishConnected(
  deps: PipelineDeps,
  input: {
    clientId: string;
    adAccountId: string;
    pageId: string;
    igId: string | null;
    destinations: MessageDestination[];
  },
): Promise<void> {
  const event: MetaConnectedEvent = {
    id: deps.newId(),
    type: 'meta.connected',
    occurredAt: deps.now().toISOString(),
    clientId: input.clientId,
    // At-least-once delivery: the next module deduplicates on this.
    idempotencyKey: metaConnectedKey(input.clientId, input.adAccountId),
    data: {
      adAccountId: input.adAccountId,
      pageId: input.pageId,
      igId: input.igId,
      messageDestinations:
        input.destinations.length > 0 ? input.destinations : [...DEFAULT_MESSAGE_DESTINATIONS],
    },
  };
  await deps.events.publish(event);
  log('info', 'meta_connected_published', {
    request_id: deps.requestId,
    client_id: input.clientId,
  });
}
