import { describe, expect, it } from 'vitest';
import { loginHref, resolveRoute } from './route';

describe('resolveRoute', () => {
  it('shows the connect page with the state from the link', () => {
    expect(resolveRoute('/connect', '?state=abc.def')).toEqual({
      name: 'connect',
      state: 'abc.def',
    });
    expect(resolveRoute('/connect/', '?state=abc.def')).toEqual({
      name: 'connect',
      state: 'abc.def',
    });
  });

  it('a link without a state still resolves, so the page can say it is invalid', () => {
    expect(resolveRoute('/connect', '')).toEqual({ name: 'connect', state: null });
    expect(resolveRoute('/connect', '?state=')).toEqual({ name: 'connect', state: null });
  });

  it('decodes the result from the query string', () => {
    expect(
      resolveRoute('/connect/result', '?status=needs_action&reasons=NO_PAGE&retry=s.t'),
    ).toEqual({
      name: 'result',
      result: { status: 'needs_action', reasons: ['NO_PAGE'], retryState: 's.t' },
    });
  });

  it('turns a tampered or empty result into a generic error', () => {
    expect(resolveRoute('/connect/result', '?status=<script>')).toEqual({
      name: 'result',
      result: { status: 'error', reasons: [] },
    });
    expect(resolveRoute('/connect/result', '')).toMatchObject({ result: { status: 'error' } });
  });

  it('everything else is home', () => {
    for (const path of ['/', '', '/other', '/connect/result/extra']) {
      expect(resolveRoute(path, '').name).toBe('home');
    }
  });
});

describe('loginHref', () => {
  it('points the button at the API and encodes the state', () => {
    expect(loginHref('https://api.fluvia.co/', 'a.b+c')).toBe(
      'https://api.fluvia.co/meta/login?state=a.b%2Bc',
    );
  });
});
