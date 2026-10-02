import { describe, expect, it } from 'vitest';
import { decodeConnectResult, encodeConnectResult } from './index';

describe('connect result codec', () => {
  it('round-trips status, reasons and retry state', () => {
    const result = {
      status: 'needs_action' as const,
      reasons: ['PAGE_NOT_ADMIN' as const, 'PAGE_UNPUBLISHED' as const],
      retryState: 'abc.def',
    };
    expect(decodeConnectResult(encodeConnectResult(result))).toEqual(result);
  });

  it('encodes a plain ok result with no extras', () => {
    expect(encodeConnectResult({ status: 'ok', reasons: [] })).toBe('status=ok');
    expect(decodeConnectResult('status=ok')).toEqual({ status: 'ok', reasons: [] });
  });

  it('treats a missing or unknown status as a generic error', () => {
    expect(decodeConnectResult('')).toEqual({ status: 'error', reasons: [] });
    expect(decodeConnectResult('status=hacked&reasons=PAGE_NOT_ADMIN')).toEqual({
      status: 'error',
      reasons: [],
    });
  });

  it('drops unknown reasons', () => {
    expect(
      decodeConnectResult('status=needs_action&reasons=PAGE_NOT_ADMIN,<script>,NO_PAGE'),
    ).toEqual({
      status: 'needs_action',
      reasons: ['PAGE_NOT_ADMIN', 'NO_PAGE'],
    });
  });
});
