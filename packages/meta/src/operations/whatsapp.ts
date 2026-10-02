import { z } from 'zod';
import type { MetaClient } from '../client';
import { MetaApiError } from '../errors';
import { numericId } from './ids';
import { parseBody } from './parse';

export type WhatsAppLink =
  | { status: 'linked'; number: string }
  | { status: 'not_linked' }
  /** Meta does not let us read it: a person has to check (docs/plan-meta.md §7, WA_VERIFY_MANUAL). */
  | { status: 'unavailable'; reason: string };

const pageWhatsAppSchema = z.object({
  id: z.string(),
  whatsapp_number: z.string().optional(),
});

/**
 * 🔴 UNCONFIRMED. Reads the WhatsApp number linked to a page through the page's
 * `whatsapp_number` field. Whether Meta exposes that field to us, and whether it reflects
 * the link ads use, is unknown (docs/plan-meta.md §7). A refusal is not "not linked": it
 * becomes `unavailable` so a human verifies instead of us guessing.
 */
export async function getWhatsAppLink(client: MetaClient, pageId: string): Promise<WhatsAppLink> {
  const id = numericId(pageId, 'pageId');
  try {
    const res = await client.get(`/${id}`, { fields: 'whatsapp_number' });
    const page = parseBody(pageWhatsAppSchema, res.body, 'getWhatsAppLink');
    return page.whatsapp_number
      ? { status: 'linked', number: page.whatsapp_number }
      : { status: 'not_linked' };
  } catch (err) {
    if (
      err instanceof MetaApiError &&
      (err.category === 'permission' || err.category === 'invalid_request')
    ) {
      return { status: 'unavailable', reason: `${err.category}:${err.code ?? err.status}` };
    }
    throw err;
  }
}
