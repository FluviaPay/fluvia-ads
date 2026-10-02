type Lease = { lease: string; until: number };

const MAX_TTL_SECONDS = 900;

/**
 * Per-client lock (docs/plan-meta.md §6.6, §8.3): the setup of one client never runs twice
 * at the same time, so a duplicated queue message cannot create two ad accounts.
 * A Durable Object is single-threaded, so check-and-set is safe. The lease expires, so a
 * crashed run cannot block the client forever.
 *
 *   POST /acquire {ttlSeconds}  -> 200 {lease} | 409
 *   POST /release {lease}       -> 200
 */
export class ClientLock {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const body = (await request.json().catch(() => ({}))) as {
      ttlSeconds?: unknown;
      lease?: unknown;
    };
    const current = await this.state.storage.get<Lease>('lease');
    const now = Date.now();

    if (pathname === '/acquire') {
      if (current && current.until > now) return new Response(null, { status: 409 });
      const requested = typeof body.ttlSeconds === 'number' ? body.ttlSeconds : 300;
      const ttl = Math.min(Math.max(requested, 1), MAX_TTL_SECONDS) * 1000;
      const lease = crypto.randomUUID();
      await this.state.storage.put<Lease>('lease', { lease, until: now + ttl });
      return Response.json({ lease });
    }

    if (pathname === '/release') {
      // Only the holder can release; a stale holder cannot free someone else's lease.
      if (current && current.lease === body.lease) await this.state.storage.delete('lease');
      return Response.json({ released: true });
    }

    return new Response('Not found', { status: 404 });
  }
}
