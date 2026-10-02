import {
  checkPagePermissions,
  getInstagramAccount,
  getWhatsAppLink,
  type MetaClient,
} from '@fluvia/meta';
import type { SetupTaskCode } from './task-catalog';

export type MessageDestination = 'whatsapp' | 'instagram_direct' | 'messenger';

export type SetupFailure = { code: SetupTaskCode; detail?: string | undefined };

export type ConnectionValidation = {
  /** Every problem at once, so the team fixes them in one go. */
  failures: SetupFailure[];
  igId: string | null;
};

/**
 * docs/plan-meta.md §7, run with the CLIENT's token (it needs the client's own rights):
 * admin role, permissions and published page; Instagram professional when Instagram
 * Direct is a destination; WhatsApp linked when WhatsApp is a destination.
 * Page restrictions are probed later: they need the ad account to exist.
 */
export async function validateConnection(
  client: MetaClient,
  input: { pageId: string; destinations: readonly MessageDestination[] },
): Promise<ConnectionValidation> {
  const wantsWhatsApp = input.destinations.includes('whatsapp');
  const wantsInstagram = input.destinations.includes('instagram_direct');

  const [check, instagram, whatsapp] = await Promise.all([
    checkPagePermissions(client, input.pageId, { whatsapp: wantsWhatsApp }),
    getInstagramAccount(client, input.pageId),
    wantsWhatsApp ? getWhatsAppLink(client, input.pageId) : Promise.resolve(null),
  ]);

  const failures: SetupFailure[] = check.failures.map((f) => ({ code: f.code, detail: f.detail }));

  if (wantsInstagram && !instagram) failures.push({ code: 'IG_NOT_PROFESSIONAL' });

  if (whatsapp?.status === 'not_linked') failures.push({ code: 'WA_NOT_LINKED' });
  if (whatsapp?.status === 'unavailable') {
    failures.push({ code: 'WA_VERIFY_MANUAL', detail: whatsapp.reason });
  }

  return { failures, igId: instagram?.id ?? null };
}
