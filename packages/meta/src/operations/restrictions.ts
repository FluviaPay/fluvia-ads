import type { MetaClient } from '../client';
import { MetaApiError, MetaInputError } from '../errors';
import { adAccountId, numericId } from './ids';

export type PageProbe =
  | { status: 'ok'; simulated?: true }
  | { status: 'restricted'; code: number | undefined }
  /** Meta refused for a reason that does not prove a restriction: a person verifies. */
  | { status: 'unverified'; reason: string };

/**
 * 🔴 UNCONFIRMED (docs/plan-meta.md §7, PAGE_RESTRICTED "plan B"). There is no known field
 * that exposes page restrictions, so this asks Meta to VALIDATE (not create) an ad creative
 * for the page on an ad account (`execution_options: validate_only`). It therefore needs the
 * ad account to exist and the page to be assigned to it.
 * Only a policy error counts as "restricted"; other refusals are `unverified`, never a guess.
 * Sandbox never touches real pages (rule 7): it returns `simulated`.
 */
export async function probePageRestrictions(
  client: MetaClient,
  input: { adAccountId: string; pageId: string; link: string },
): Promise<PageProbe> {
  const pageId = numericId(input.pageId, 'pageId');
  const account = client.resolveAdAccountId(adAccountId(input.adAccountId, 'adAccountId'));
  try {
    new URL(input.link);
  } catch {
    throw new MetaInputError('link must be a valid URL');
  }
  if (client.mode === 'sandbox') return { status: 'ok', simulated: true };

  try {
    await client.post(`/${account}/adcreatives`, {
      name: 'FLV_validation_probe',
      object_story_spec: {
        page_id: pageId,
        link_data: { link: input.link, message: 'Fluvia validation' },
      },
      execution_options: ['validate_only'],
    });
    return { status: 'ok' };
  } catch (err) {
    if (err instanceof MetaApiError) {
      if (err.category === 'policy') return { status: 'restricted', code: err.code };
      if (err.category === 'permission' || err.category === 'invalid_request') {
        return { status: 'unverified', reason: `${err.category}:${err.code ?? err.status}` };
      }
    }
    throw err;
  }
}
