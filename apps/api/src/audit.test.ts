import { expect, it } from 'vitest';
import { writeAuditLog } from './audit';
import { fakeDb } from './test-utils';

function recordingDb(returned: { id: string }[]) {
  const calls: { values?: unknown } = {};
  const db = fakeDb({
    insert: () => ({
      values: (v: unknown) => {
        calls.values = v;
        return { returning: async () => returned };
      },
    }),
  });
  return { db, calls };
}

it('inserts the entry into audit_log and returns the new id', async () => {
  const { db, calls } = recordingDb([{ id: 'abc' }]);
  const id = await writeAuditLog(db, {
    actorType: 'ai',
    actorId: 'strategist',
    action: 'campaign.proposed',
    clientId: 'c1',
    after: { objective: 'messages' },
  });
  expect(id).toBe('abc');
  expect(calls.values).toEqual({
    actorType: 'ai',
    actorId: 'strategist',
    action: 'campaign.proposed',
    clientId: 'c1',
    entityType: null,
    entityId: null,
    before: null,
    after: { objective: 'messages' },
  });
});

it('throws if nothing was inserted', async () => {
  const { db } = recordingDb([]);
  await expect(writeAuditLog(db, { actorType: 'system', action: 'x' })).rejects.toThrow();
});
