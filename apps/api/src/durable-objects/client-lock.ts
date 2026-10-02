/** Per-client lock. Declared in wrangler.toml; real logic comes with the module that needs it. */
export class ClientLock {
  async fetch(): Promise<Response> {
    return new Response('Not implemented', { status: 501 });
  }
}
