import { z } from 'zod';
import type { MetaClient } from '../client';
import { MetaPaginationLimitError, MetaSchemaError } from '../errors';
import { parseBody } from './parse';

export const DEFAULT_MAX_PAGES = 5;
const PAGE_SIZE = '100';

/**
 * Follows `paging.cursors.after` (never the full `next` URL, so we only ever call Meta
 * paths we built ourselves). If there is still more after `maxPages`, it fails loudly
 * instead of silently returning a truncated list.
 */
export async function listAll<T>(
  client: MetaClient,
  path: string,
  query: Record<string, string>,
  itemSchema: z.ZodType<T>,
  what: string,
  maxPages: number = DEFAULT_MAX_PAGES,
): Promise<T[]> {
  const envelope = z.object({
    data: z.array(itemSchema),
    paging: z
      .object({
        next: z.string().optional(),
        cursors: z.object({ after: z.string().optional() }).optional(),
      })
      .optional(),
  });

  const items: T[] = [];
  let after: string | undefined;
  for (let page = 1; page <= maxPages; page++) {
    const res = await client.get(path, { ...query, limit: PAGE_SIZE, ...(after ? { after } : {}) });
    const parsed = parseBody(envelope, res.body, what);
    items.push(...parsed.data);
    if (!parsed.paging?.next) return items;
    after = parsed.paging.cursors?.after;
    if (!after) throw new MetaSchemaError(what, 'paging.next without paging.cursors.after');
  }
  throw new MetaPaginationLimitError(what, maxPages);
}
