type Window = { count: number; resetAt: number };

/**
 * Fixed-window counter, one Durable Object per key (an IP, an email hash...).
 * Single-threaded, so count-and-compare is race free. An alarm deletes the state when the
 * window ends, so keys do not pile up.
 *
 *   POST /hit {limit, windowSeconds} -> 200 {allowed, retryAfterSeconds}
 */
export class RateLimiter {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const body = (await request.json().catch(() => ({}))) as {
      limit?: unknown;
      windowSeconds?: unknown;
    };
    const limit = typeof body.limit === 'number' ? Math.max(1, Math.floor(body.limit)) : 10;
    const windowMs =
      (typeof body.windowSeconds === 'number' ? Math.max(1, body.windowSeconds) : 60) * 1000;

    const now = Date.now();
    let window = await this.state.storage.get<Window>('window');
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + windowMs };
      await this.state.storage.setAlarm(window.resetAt);
    }
    window.count += 1;
    await this.state.storage.put('window', window);

    const allowed = window.count <= limit;
    return Response.json({
      allowed,
      retryAfterSeconds: allowed ? 0 : Math.ceil((window.resetAt - now) / 1000),
    });
  }

  async alarm(): Promise<void> {
    await this.state.storage.deleteAll();
  }
}
