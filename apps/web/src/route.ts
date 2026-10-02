import { decodeConnectResult, type ConnectResult } from '@fluvia/shared';

export type Route =
  | { name: 'home' }
  | { name: 'connect'; state: string | null }
  | { name: 'result'; result: ConnectResult };

/** No router library: the page only has three views. */
export function resolveRoute(pathname: string, search: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/connect') {
    return { name: 'connect', state: new URLSearchParams(search).get('state') || null };
  }
  if (path === '/connect/result') return { name: 'result', result: decodeConnectResult(search) };
  return { name: 'home' };
}

/** The button goes to the API, which checks the state and sends the browser to Facebook. */
export function loginHref(apiBaseUrl: string, state: string): string {
  return `${apiBaseUrl.replace(/\/+$/, '')}/meta/login?state=${encodeURIComponent(state)}`;
}
