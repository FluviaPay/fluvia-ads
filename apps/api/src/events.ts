import type { FluviaEvent } from '@fluvia/shared';

/** Publishes events to the queue. At-least-once: consumers deduplicate. */
export type EventPublisher = {
  publish(event: FluviaEvent): Promise<void>;
};

export const queuePublisher = (queue: Queue): EventPublisher => ({
  async publish(event) {
    await queue.send(event);
  },
});
