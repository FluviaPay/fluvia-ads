import { describe, expect, it } from 'vitest';
import { acknowledgeableCodeSchema, fluviaEventSchema, metaConnectedKey } from './index';

const base = {
  id: '5b1a2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
  occurredAt: '2026-10-02T12:00:00.000Z',
  clientId: '0b6f6f9e-1c1a-4d5e-9a57-2f2f7b1b0a11',
};

describe('fluviaEventSchema', () => {
  it('parses meta.connection.received, defaulting acknowledged to []', () => {
    const event = fluviaEventSchema.parse({ ...base, type: 'meta.connection.received' });
    expect(event).toMatchObject({ type: 'meta.connection.received', acknowledged: [] });
  });

  it('only lets a human acknowledge what the API cannot verify', () => {
    expect(acknowledgeableCodeSchema.safeParse('WA_VERIFY_MANUAL').success).toBe(true);
    for (const code of [
      'PAGE_RESTRICTED',
      'IG_NOT_PROFESSIONAL',
      'AUTH_EXPIRED',
      'PAGE_NOT_ADMIN',
    ]) {
      expect(acknowledgeableCodeSchema.safeParse(code).success, code).toBe(false);
    }
  });

  it('parses meta.connected with its idempotency key and data', () => {
    const event = fluviaEventSchema.parse({
      ...base,
      type: 'meta.connected',
      idempotencyKey: metaConnectedKey(base.clientId, 'act_1'),
      data: { adAccountId: 'act_1', pageId: '100', igId: null, messageDestinations: ['whatsapp'] },
    });
    expect(event.type).toBe('meta.connected');
    expect(metaConnectedKey(base.clientId, 'act_1')).toBe(`meta.connected:${base.clientId}:act_1`);
  });

  it('rejects unknown types and malformed events', () => {
    expect(fluviaEventSchema.safeParse({ ...base, type: 'other' }).success).toBe(false);
    expect(fluviaEventSchema.safeParse({ type: 'meta.connected' }).success).toBe(false);
    expect(
      fluviaEventSchema.safeParse({ ...base, type: 'meta.connection.received', clientId: 'x' })
        .success,
    ).toBe(false);
  });
});
