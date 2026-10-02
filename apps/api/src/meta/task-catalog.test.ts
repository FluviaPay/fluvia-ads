import { describe, expect, it } from 'vitest';
import { SETUP_TASK_CODES, buildTask } from './task-catalog';

const context = {
  clientId: '0b6f6f9e-1c1a-4d5e-9a57-2f2f7b1b0a11',
  clientName: 'Peluquería Luna',
  whatsapp: '573001112233',
  pageId: '100000000000001',
  igId: '17841400000000001',
  adAccountId: 'act_1000000000000001',
  detail: 'create:permission:200',
};

describe('buildTask', () => {
  it.each(SETUP_TASK_CODES)('%s has a Spanish title and a concrete instruction', (code) => {
    const task = buildTask(code, context);
    expect(task.type).toBe(`meta.setup.${code}`);
    expect(task.title.length).toBeGreaterThan(10);
    const instruction = task.payload.instruction as string;
    expect(instruction.length).toBeGreaterThan(40);
    expect(instruction).not.toContain('undefined');
    expect(instruction).not.toContain('null');
    // Every instruction names who it is about.
    expect(instruction).toMatch(/Peluquería Luna/);
  });

  it('every payload says exactly how to resume (endpoint) and carries the ids', () => {
    for (const code of SETUP_TASK_CODES) {
      const { payload } = buildTask(code, context);
      expect(payload).toMatchObject({
        code,
        clientId: context.clientId,
        pageId: '100000000000001',
        adAccountId: 'act_1000000000000001',
        retry: { method: 'POST', path: `/meta/connections/${context.clientId}/process` },
      });
    }
  });

  it('manual-check tasks tell the human to acknowledge that exact code', () => {
    for (const code of [
      'WA_VERIFY_MANUAL',
      'PAGE_RESTRICTION_UNVERIFIED',
      'PAGE_ASSIGN_MANUAL',
      'PAGE_ASSIGN_PENDING_CLIENT',
    ] as const) {
      const instruction = buildTask(code, context).payload.instruction as string;
      expect(instruction, code).toContain(`{"acknowledged":["${code}"]}`);
    }
  });

  it('tasks that need the client to reconnect say how to generate a new link', () => {
    for (const code of ['AUTH_EXPIRED', 'RECONNECT_REQUIRED', 'PERMISSIONS_MISSING'] as const) {
      expect(buildTask(code, context).payload.instruction as string).toContain(
        'POST /meta/connections/link',
      );
    }
  });

  it('degrades gracefully when the client name or page is unknown', () => {
    const task = buildTask('ENQUEUE_FAILED', { clientId: context.clientId });
    const instruction = task.payload.instruction as string;
    expect(instruction).toContain(`el cliente ${context.clientId}`);
    expect(instruction).not.toContain('undefined');
    expect(
      buildTask('IG_NOT_PROFESSIONAL', { clientId: context.clientId }).payload.instruction,
    ).toContain('(sin página)');
  });

  it('never states a Meta menu path as fact', () => {
    for (const code of SETUP_TASK_CODES) {
      const instruction = buildTask(code, context).payload.instruction as string;
      expect(instruction).not.toMatch(/→|>>/);
    }
  });
});
