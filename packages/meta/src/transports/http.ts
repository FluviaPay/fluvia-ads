import { GRAPH_BASE_URL, META_GRAPH_VERSION } from '../version';
import type { MetaTransport } from '../transport';

type HttpOptions = { token: string; fetch?: typeof fetch; baseUrl?: string };

/** Real Graph API calls (sandbox and live). The token travels in a header, never in the URL. */
export function createHttpTransport({
  token,
  fetch: fetchImpl = fetch,
  baseUrl = GRAPH_BASE_URL,
}: HttpOptions): MetaTransport {
  return async ({ method, path, query, body }) => {
    const url = new URL(`${baseUrl}/${META_GRAPH_VERSION}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);

    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    const res = await fetchImpl(url, init);
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { raw: text.slice(0, 500) };
    }
    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      responseHeaders[key.toLowerCase()] = value;
    });
    return { status: res.status, headers: responseHeaders, body: parsed };
  };
}
