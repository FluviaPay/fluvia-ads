import { app } from './app';
import type { Bindings } from './env';
import { handleQueueBatch } from './queue';

export { ClientLock } from './durable-objects/client-lock';

export default {
  fetch: app.fetch,
  queue: (batch: MessageBatch<unknown>, env: Bindings) => handleQueueBatch(batch, env),
} satisfies ExportedHandler<Bindings>;
