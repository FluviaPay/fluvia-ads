import { z } from 'zod';
import type { MetaClient } from '../client';
import { MetaApiError } from '../errors';
import { adAccountId, numericId } from './ids';
import { parseBody } from './parse';

export type AssignPageInput = {
  businessId: string;
  pageId: string;
  adAccountId: string;
  /** Fluvia's system user, which makes the API calls. */
  systemUserId: string;
  /** 🔶 Task names unconfirmed. */
  tasks?: string[];
};

export type AssignPageResult = {
  status: 'assigned' | 'pending_client_approval' | 'manual_required';
  pageId: string;
  adAccountId: string;
  /** Sandbox: nothing was sent to Meta. */
  simulated?: true;
  /** Why a human is needed: `category:code`, never Meta's message text. */
  reason?: string;
};

const successSchema = z.object({ success: z.boolean() });

/**
 * 🔴 UNCONFIRMED. docs/plan-meta.md §9.1 does not know how Fluvia gets access to a client's
 * page; this implements "option B" and every endpoint below is a guess to validate:
 *   1. POST /{business}/client_pages  -> Fluvia asks for advertiser access to the page;
 *   2. POST /{page}/assigned_users    -> the system user is given the page tasks.
 * Outcomes map to what the orchestrator does next:
 *   assigned                 -> continue;
 *   pending_client_approval  -> step 2 refused, the client probably has not approved step 1;
 *   manual_required          -> step 1 refused: create the one-click human task (CLAUDE.md).
 * Sandbox never calls Meta (rule 7: no real pages), it returns `simulated`.
 */
export async function assignPageToAdAccount(
  client: MetaClient,
  input: AssignPageInput,
): Promise<AssignPageResult> {
  const businessId = numericId(input.businessId, 'businessId');
  const pageId = numericId(input.pageId, 'pageId');
  const systemUserId = numericId(input.systemUserId, 'systemUserId');
  const account = client.resolveAdAccountId(adAccountId(input.adAccountId, 'adAccountId'));
  const tasks = input.tasks ?? ['ADVERTISE', 'ANALYZE'];
  const base = { pageId, adAccountId: account };

  if (client.mode === 'sandbox') return { ...base, status: 'assigned', simulated: true };

  try {
    const res = await client.post(`/${businessId}/client_pages`, {
      page_id: pageId,
      permitted_tasks: tasks,
    });
    parseBody(successSchema, res.body, 'assignPageToAdAccount (request access)');
  } catch (err) {
    if (isRefusal(err)) return { ...base, status: 'manual_required', reason: refusal(err) };
    throw err;
  }

  try {
    const res = await client.post(`/${pageId}/assigned_users`, { user: systemUserId, tasks });
    parseBody(successSchema, res.body, 'assignPageToAdAccount (assign user)');
  } catch (err) {
    if (isRefusal(err)) return { ...base, status: 'pending_client_approval', reason: refusal(err) };
    throw err;
  }
  return { ...base, status: 'assigned' };
}

/** Meta said "no" (permissions / unsupported), as opposed to "try later" or "something broke". */
function isRefusal(err: unknown): err is MetaApiError {
  return (
    err instanceof MetaApiError &&
    (err.category === 'permission' || err.category === 'invalid_request')
  );
}

const refusal = (err: MetaApiError) => `${err.category}:${err.code ?? err.status}`;
