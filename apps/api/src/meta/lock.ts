export type ClientLockPort = {
  /** A lease token, or null when someone else holds the lock. */
  acquire(clientId: string): Promise<string | null>;
  release(clientId: string, lease: string): Promise<void>;
};

/** The lock lives in the ClientLock Durable Object, one instance per client. */
export function createDoLock(namespace: DurableObjectNamespace, ttlSeconds = 300): ClientLockPort {
  const stubFor = (clientId: string) => namespace.get(namespace.idFromName(clientId));
  const call = (clientId: string, path: string, body: unknown) =>
    stubFor(clientId).fetch(`https://client-lock${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });

  return {
    async acquire(clientId) {
      const res = await call(clientId, '/acquire', { ttlSeconds });
      if (res.status === 409) return null;
      if (!res.ok) throw new Error(`ClientLock acquire failed with status ${res.status}`);
      return ((await res.json()) as { lease: string }).lease;
    },
    async release(clientId, lease) {
      const res = await call(clientId, '/release', { lease });
      if (!res.ok) throw new Error(`ClientLock release failed with status ${res.status}`);
    },
  };
}
