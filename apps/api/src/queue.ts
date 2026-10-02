import { createDb } from '@fluvia/db';
import { fluviaEventSchema } from '@fluvia/shared';
import { createDoLock } from './meta/lock';
import { log } from './logger';
import { queuePublisher } from './events';
import type { Bindings } from './env';
import { resolveConnectConfig } from './meta/config';
import { MAX_ATTEMPTS, processConnection, type PipelineDeps } from './meta/pipeline';
import { resolveSetupConfig } from './meta/setup-config';
import { createSetupStore } from './meta/setup-store';
import { buildTask } from './meta/task-catalog';
import { defaultMetaFactory } from './routes/meta';

export function defaultPipelineDeps(env: Bindings): PipelineDeps {
  const connect = resolveConnectConfig(env);
  return {
    store: createSetupStore(createDb(env.DATABASE_URL)),
    meta: (token) => defaultMetaFactory(env, token),
    lock: createDoLock(env.CLIENT_LOCK),
    events: queuePublisher(env.EVENTS_QUEUE),
    setup: resolveSetupConfig(env),
    tokenKey: connect.tokenKey,
    webBaseUrl: connect.webBaseUrl,
    now: () => new Date(),
    newId: () => crypto.randomUUID(),
  };
}

const backoffSeconds = (attempts: number) => Math.min(900, 30 * 2 ** Math.max(attempts - 1, 0));

/**
 * Queue consumer (docs/plan-meta.md §14). One message = one client's connection setup.
 * Anything the Meta side cannot do becomes a task; only genuinely unexpected failures
 * (database down, a bug) are retried here, and after the last attempt they become a task too.
 */
export async function handleQueueBatch(
  batch: MessageBatch<unknown>,
  env: Bindings,
  makeDeps: (env: Bindings) => PipelineDeps = defaultPipelineDeps,
): Promise<void> {
  let deps: PipelineDeps | undefined;
  let depsError: unknown;
  try {
    deps = makeDeps(env);
  } catch (err) {
    depsError = err;
  }

  for (const message of batch.messages) {
    const parsed = fluviaEventSchema.safeParse(message.body);
    if (!parsed.success) {
      // A malformed message will never get better: drop it, loudly.
      log('error', 'queue_invalid_event', { message_id: message.id });
      message.ack();
      continue;
    }

    const event = parsed.data;
    if (event.type !== 'meta.connection.received') {
      // meta.connected has no consumer until the payment step exists.
      log('info', 'queue_event_without_handler', { type: event.type, message_id: message.id });
      message.ack();
      continue;
    }

    try {
      if (!deps) throw depsError;
      const result = await processConnection(deps, {
        clientId: event.clientId,
        acknowledged: new Set(event.acknowledged),
        attempt: message.attempts,
      });
      if (result.kind === 'retry') message.retry({ delaySeconds: result.delaySeconds });
      else message.ack();
    } catch (err) {
      log('error', 'queue_message_failed', {
        message_id: message.id,
        client_id: event.clientId,
        attempts: message.attempts,
        error: err instanceof Error ? err.name : 'unknown',
      });
      if (message.attempts >= MAX_ATTEMPTS) {
        await recordFinalFailure(deps, event.clientId, err);
        message.ack();
      } else {
        message.retry({ delaySeconds: backoffSeconds(message.attempts) });
      }
    }
  }
}

async function recordFinalFailure(deps: PipelineDeps | undefined, clientId: string, err: unknown) {
  if (!deps) return;
  try {
    await deps.store.recordNeedsAction({
      clientId,
      codes: ['SETUP_FAILED_TECHNICAL'],
      tasks: [
        buildTask('SETUP_FAILED_TECHNICAL', {
          clientId,
          detail: `unexpected:${err instanceof Error ? err.name : 'unknown'}`,
        }),
      ],
    });
  } catch (inner) {
    log('error', 'queue_final_failure_not_recorded', {
      client_id: clientId,
      error: inner instanceof Error ? inner.name : 'unknown',
    });
  }
}
