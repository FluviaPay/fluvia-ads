import { connectReasonSchema, connectStatusSchema } from '@fluvia/shared';
import { describe, expect, it } from 'vitest';
import { REASON_TEXT, resultView } from './messages';

describe('resultView', () => {
  it('has a text for every status and every reason (nothing falls through)', () => {
    for (const status of connectStatusSchema.options) {
      const view = resultView({ status, reasons: [] });
      expect(view.title.length, status).toBeGreaterThan(0);
      expect(view.body.length, status).toBeGreaterThan(0);
    }
    expect(Object.keys(REASON_TEXT).sort()).toEqual([...connectReasonSchema.options].sort());
  });

  it('ok is a success with no retry', () => {
    expect(resultView({ status: 'ok', reasons: [] })).toMatchObject({
      tone: 'success',
      canRetry: false,
    });
  });

  it('needs_action lists what to fix, in the order given, and offers retry only with a state', () => {
    const reasons = ['PAGE_NOT_ADMIN', 'PAGE_UNPUBLISHED'] as const;
    const view = resultView({ status: 'needs_action', reasons: [...reasons], retryState: 's.t' });
    expect(view.items).toEqual([REASON_TEXT.PAGE_NOT_ADMIN, REASON_TEXT.PAGE_UNPUBLISHED]);
    expect(view.canRetry).toBe(true);
    expect(resultView({ status: 'needs_action', reasons: [...reasons] }).canRetry).toBe(false);
  });

  it('an invalid link never offers retry, even if a state is smuggled in', () => {
    const view = resultView({ status: 'invalid_state', reasons: [], retryState: 's.t' });
    expect(view).toMatchObject({ tone: 'error', canRetry: false });
  });

  it('cancelled and error can retry when the API gave a fresh state', () => {
    for (const status of ['cancelled', 'error'] as const) {
      expect(resultView({ status, reasons: [], retryState: 's.t' }).canRetry).toBe(true);
      expect(resultView({ status, reasons: [] }).canRetry).toBe(false);
    }
  });

  it('texts are in Spanish and never mention technical terms', () => {
    const all = connectStatusSchema.options.flatMap((status) => {
      const view = resultView({ status, reasons: [...connectReasonSchema.options] });
      return [view.title, view.body, ...view.items];
    });
    for (const text of all) {
      expect(text).not.toMatch(/token|nonce|state|oauth|api|error code/i);
    }
  });
});
