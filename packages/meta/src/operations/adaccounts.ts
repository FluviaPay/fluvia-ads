import { z } from 'zod';
import type { MetaClient } from '../client';
import { MetaConflictError, MetaInputError, MetaNetworkError } from '../errors';
import { adAccountId, numericId } from './ids';
import { listAll } from './paging';
import { parseBody } from './parse';

const AD_ACCOUNT_FIELDS = 'id,account_id,name,account_status,disable_reason,currency,timezone_name';

/** 🔶 Status codes from memory; unknown codes map to `UNKNOWN`. */
const STATUS_NAMES: Record<number, AdAccountStatus> = {
  1: 'ACTIVE',
  2: 'DISABLED',
  3: 'UNSETTLED',
  7: 'PENDING_RISK_REVIEW',
  8: 'PENDING_SETTLEMENT',
  9: 'IN_GRACE_PERIOD',
  100: 'PENDING_CLOSURE',
  101: 'CLOSED',
};

export type AdAccountStatus =
  | 'ACTIVE'
  | 'DISABLED'
  | 'UNSETTLED'
  | 'PENDING_RISK_REVIEW'
  | 'PENDING_SETTLEMENT'
  | 'IN_GRACE_PERIOD'
  | 'PENDING_CLOSURE'
  | 'CLOSED'
  | 'UNKNOWN';

export type AdAccount = {
  /** Always with the `act_` prefix. */
  id: string;
  name: string;
  status: AdAccountStatus;
  statusCode: number;
  disableReason: number | undefined;
  currency: string;
  timezoneName: string;
};

const adAccountSchema = z.object({
  id: z.string(),
  account_id: z.string(),
  name: z.string(),
  account_status: z.number().int(),
  disable_reason: z.number().int().optional(),
  currency: z.string(),
  timezone_name: z.string(),
});

function toAdAccount(raw: z.output<typeof adAccountSchema>): AdAccount {
  return {
    id: adAccountId(raw.account_id, 'account_id'),
    name: raw.name,
    status: STATUS_NAMES[raw.account_status] ?? 'UNKNOWN',
    statusCode: raw.account_status,
    disableReason: raw.disable_reason,
    currency: raw.currency,
    timezoneName: raw.timezone_name,
  };
}

/** 🔶 Reads an ad account. In sandbox mode any id resolves to the sandbox account. */
export async function getAdAccount(client: MetaClient, id: string): Promise<AdAccount> {
  const accountId = client.resolveAdAccountId(adAccountId(id, 'adAccountId'));
  const res = await client.get(`/${accountId}`, { fields: AD_ACCOUNT_FIELDS });
  return toAdAccount(parseBody(adAccountSchema, res.body, 'getAdAccount'));
}

export type CreateAdAccountInput = {
  /** Fluvia's portfolio (META_BUSINESS_ID). */
  businessId: string;
  clientId: string;
  /**
   * Meta's numeric id for America/Bogota. 🔶 Not hard-coded on purpose: resolve it from
   * Meta's timezone list (docs/plan-meta.md §8.1).
   */
  timezoneId: number;
  /** 🔶 Required by Meta; what to declare is still an open decision (plan §18.5). */
  endAdvertiser: string;
  mediaAgency: string;
  partner: string;
};

/** Deterministic name: it is the key used to reconcile (docs/plan-meta.md §8.3). */
export function adAccountName(clientId: string): string {
  if (!/^[A-Za-z0-9-]+$/.test(clientId))
    throw new MetaInputError('clientId has invalid characters');
  return `FLV_${clientId}`;
}

async function findOwnedByName(
  client: MetaClient,
  businessId: string,
  name: string,
): Promise<AdAccount | undefined> {
  const accounts = await listAll(
    client,
    `/${businessId}/owned_ad_accounts`,
    { fields: AD_ACCOUNT_FIELDS },
    adAccountSchema,
    'createAdAccount (lookup)',
  );
  const match = accounts.find((a) => a.name === name);
  return match && toAdAccount(match);
}

function assertCop(account: AdAccount): AdAccount {
  if (account.currency !== 'COP') {
    // Currency cannot be changed after creation.
    throw new MetaConflictError(
      `Ad account ${account.id} exists with currency ${account.currency}; expected COP`,
    );
  }
  return account;
}

const createdSchema = z.object({ id: z.string() });

/**
 * 🔶 Creates the client's ad account in Fluvia's portfolio (COP). Idempotent:
 * 1. looks for an account named `FLV_{clientId}` and reuses it;
 * 2. otherwise creates it, and if the call dies on the network (Meta may have processed it)
 *    looks again before giving up. Writes are never retried blindly.
 * Callers must hold the per-client lock. In sandbox mode nothing is created: the sandbox
 * account is returned.
 *
 * The lookup lists the portfolio's accounts, so it fails loudly past 5 pages (500 accounts).
 * The orchestrator should check `meta_connections.ad_account_id` first and use this lookup
 * only for reconciliation.
 */
export async function createAdAccount(
  client: MetaClient,
  input: CreateAdAccountInput,
): Promise<AdAccount> {
  const businessId = numericId(input.businessId, 'businessId');
  const name = adAccountName(input.clientId);

  if (client.mode === 'sandbox') return getAdAccount(client, client.resolveAdAccountId());

  const existing = await findOwnedByName(client, businessId, name);
  if (existing) return assertCop(existing);

  let createdId: string;
  try {
    const res = await client.post(`/${businessId}/adaccount`, {
      name,
      currency: 'COP',
      timezone_id: input.timezoneId,
      end_advertiser: input.endAdvertiser,
      media_agency: input.mediaAgency,
      partner: input.partner,
    });
    createdId = parseBody(createdSchema, res.body, 'createAdAccount').id;
  } catch (err) {
    if (err instanceof MetaNetworkError) {
      const reconciled = await findOwnedByName(client, businessId, name);
      if (reconciled) return assertCop(reconciled);
    }
    throw err;
  }
  return assertCop(await getAdAccount(client, createdId));
}
