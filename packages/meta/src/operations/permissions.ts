import { z } from 'zod';
import type { MetaClient } from '../client';
import { numericId } from './ids';
import { parseBody } from './parse';
import { getPages } from './pages';

/** docs/plan-meta.md §4.1. */
export const REQUIRED_PERMISSIONS = [
  'ads_management',
  'ads_read',
  'business_management',
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_ads',
  'instagram_basic',
] as const;

/** Only when the client picked WhatsApp as a destination (§4.2). */
export const WHATSAPP_PERMISSION = 'whatsapp_business_management';

/** 🔶 Task names for "full control" and "can advertise" are unconfirmed. */
export const REQUIRED_PAGE_TASKS = ['MANAGE', 'ADVERTISE'] as const;

/** Stable codes from docs/plan-meta.md §7. */
export type PageCheckCode = 'PERMISSIONS_MISSING' | 'PAGE_NOT_ADMIN' | 'PAGE_UNPUBLISHED';

export type PageCheckFailure = { code: PageCheckCode; detail: string };

export type PagePermissionCheck = {
  ok: boolean;
  /** All failures at once, so the client hears about every problem in a single answer. */
  failures: PageCheckFailure[];
  missingPermissions: string[];
};

const permissionsSchema = z.object({
  data: z.array(z.object({ permission: z.string(), status: z.string() })),
});

export async function checkPagePermissions(
  client: MetaClient,
  pageId: string,
  options: {
    whatsapp?: boolean;
    requiredPermissions?: readonly string[];
    requiredTasks?: readonly string[];
  } = {},
): Promise<PagePermissionCheck> {
  const id = numericId(pageId, 'pageId');
  const requiredPermissions = [
    ...(options.requiredPermissions ?? REQUIRED_PERMISSIONS),
    ...(options.whatsapp ? [WHATSAPP_PERMISSION] : []),
  ];
  const requiredTasks = options.requiredTasks ?? REQUIRED_PAGE_TASKS;

  const [permissionsRes, pages] = await Promise.all([
    client.get('/me/permissions'),
    getPages(client),
  ]);
  const granted = new Set(
    parseBody(permissionsSchema, permissionsRes.body, 'checkPagePermissions')
      .data.filter((p) => p.status === 'granted')
      .map((p) => p.permission),
  );

  const failures: PageCheckFailure[] = [];
  const missingPermissions = requiredPermissions.filter((p) => !granted.has(p));
  if (missingPermissions.length > 0) {
    failures.push({
      code: 'PERMISSIONS_MISSING',
      detail: `Missing permissions: ${missingPermissions.join(', ')}`,
    });
  }

  const page = pages.find((p) => p.id === id);
  if (!page) {
    failures.push({ code: 'PAGE_NOT_ADMIN', detail: 'The user has no access to this page' });
  } else {
    const missingTasks = requiredTasks.filter((t) => !page.tasks.includes(t));
    if (missingTasks.length > 0) {
      failures.push({
        code: 'PAGE_NOT_ADMIN',
        detail: `Missing page tasks: ${missingTasks.join(', ')}`,
      });
    }
    if (page.isPublished === false) {
      failures.push({ code: 'PAGE_UNPUBLISHED', detail: 'The page is not published' });
    }
  }

  return { ok: failures.length === 0, failures, missingPermissions };
}
