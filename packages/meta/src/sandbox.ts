import type { MetaRequest, MetaTransport } from './transport';

export class MetaSandboxViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetaSandboxViolation';
  }
}

const AD_ACCOUNT = /act_(\d+)/g;
const CREATES_AD_ACCOUNT = /\/(adaccounts?|owned_ad_accounts|client_ad_accounts)$/;

/**
 * Every campaign-related call uses the sandbox ad account (rule 7): ad account ids in
 * the path are replaced; any other reference (query, body) to a different account, or
 * an attempt to create ad accounts, is rejected.
 */
export function withSandbox(inner: MetaTransport, sandboxAdAccountId: string): MetaTransport {
  return (req) => {
    const rewritten: MetaRequest = {
      ...req,
      path: req.path.replace(AD_ACCOUNT, `act_${sandboxAdAccountId}`),
    };
    assertSandboxSafe(rewritten, sandboxAdAccountId);
    return inner(rewritten);
  };
}

export function assertSandboxSafe(req: MetaRequest, sandboxAdAccountId: string): void {
  if (req.method === 'POST' && CREATES_AD_ACCOUNT.test(req.path)) {
    throw new MetaSandboxViolation('Creating ad accounts is disabled in sandbox mode');
  }
  const referenced = JSON.stringify([req.path, req.query ?? null, req.body ?? null]);
  for (const match of referenced.matchAll(AD_ACCOUNT)) {
    if (match[1] !== sandboxAdAccountId) {
      throw new MetaSandboxViolation(
        `Request references ad account act_${match[1]}; sandbox only allows act_${sandboxAdAccountId}`,
      );
    }
  }
}
