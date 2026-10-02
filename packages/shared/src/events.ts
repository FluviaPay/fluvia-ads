import { z } from 'zod';

/** Events published in Queues (CLAUDE.md: each module ends by publishing the next one). */
const base = {
  id: z.uuid(),
  occurredAt: z.iso.datetime(),
  clientId: z.uuid(),
};

/**
 * Codes a human may declare as checked by hand when the API cannot verify them
 * (docs/plan-meta.md §7 and §9). Everything else must really pass.
 */
export const acknowledgeableCodeSchema = z.enum([
  'WA_VERIFY_MANUAL',
  'PAGE_RESTRICTION_UNVERIFIED',
  'PAGE_ASSIGN_MANUAL',
  'PAGE_ASSIGN_PENDING_CLIENT',
]);
export type AcknowledgeableCode = z.infer<typeof acknowledgeableCodeSchema>;

/** A connection was saved (or a person asked to re-run it): validate, create the ad account. */
export const connectionReceivedSchema = z.object({
  ...base,
  type: z.literal('meta.connection.received'),
  acknowledged: z.array(acknowledgeableCodeSchema).default([]),
});

export const messageDestinationSchema = z.enum(['whatsapp', 'instagram_direct', 'messenger']);

/** The client's Meta side is ready: next module (payment) takes over. */
export const metaConnectedSchema = z.object({
  ...base,
  type: z.literal('meta.connected'),
  /** Consumers must deduplicate on this: delivery is at-least-once. */
  idempotencyKey: z.string().min(1),
  data: z.object({
    adAccountId: z.string(),
    pageId: z.string(),
    igId: z.string().nullable(),
    messageDestinations: z.array(messageDestinationSchema),
  }),
});

export const fluviaEventSchema = z.discriminatedUnion('type', [
  connectionReceivedSchema,
  metaConnectedSchema,
]);

export type ConnectionReceivedEvent = z.output<typeof connectionReceivedSchema>;
export type MetaConnectedEvent = z.output<typeof metaConnectedSchema>;
export type FluviaEvent = z.output<typeof fluviaEventSchema>;

export const metaConnectedKey = (clientId: string, adAccountId: string) =>
  `meta.connected:${clientId}:${adAccountId}`;
