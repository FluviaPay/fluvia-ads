import { z } from 'zod';
import type { MetaClient } from '../client';
import { DEFAULT_MAX_PAGES, listAll } from './paging';
import { numericId } from './ids';
import { parseBody } from './parse';

export type Page = {
  id: string;
  name: string;
  /** Tasks the user holds on the page, e.g. MANAGE, ADVERTISE. Names 🔶 unconfirmed. */
  tasks: string[];
  isPublished: boolean | undefined;
};

const pageSchema = z.object({
  id: z.string(),
  name: z.string(),
  tasks: z.array(z.string()).default([]),
  is_published: z.boolean().optional(),
});

/** 🔶 Pages the authorized user can access (`/me/accounts`). */
export async function getPages(
  client: MetaClient,
  options: { maxPages?: number } = {},
): Promise<Page[]> {
  const pages = await listAll(
    client,
    '/me/accounts',
    { fields: 'id,name,tasks,is_published' },
    pageSchema,
    'getPages',
    options.maxPages ?? DEFAULT_MAX_PAGES,
  );
  return pages.map((p) => ({
    id: p.id,
    name: p.name,
    tasks: p.tasks,
    isPublished: p.is_published,
  }));
}

export type InstagramAccount = { id: string; username: string | undefined };

const pageInstagramSchema = z.object({
  id: z.string(),
  instagram_business_account: z
    .object({ id: z.string(), username: z.string().optional() })
    .optional(),
});

/**
 * 🔶 Instagram professional account linked to a page, or `null` when the page has none
 * (personal account, or not linked). The field name may differ across versions.
 */
export async function getInstagramAccount(
  client: MetaClient,
  pageId: string,
): Promise<InstagramAccount | null> {
  const id = numericId(pageId, 'pageId');
  const res = await client.get(`/${id}`, { fields: 'instagram_business_account{id,username}' });
  const page = parseBody(pageInstagramSchema, res.body, 'getInstagramAccount');
  const ig = page.instagram_business_account;
  return ig ? { id: ig.id, username: ig.username } : null;
}
