import type { z } from 'zod';
import { MetaSchemaError } from '../errors';

/** Zod at the border: Meta's responses are validated before anything else sees them. */
export function parseBody<T>(schema: z.ZodType<T>, body: unknown, what: string): T {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  // Paths and codes only: response values may contain personal data.
  const detail = parsed.error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.code}`)
    .join('; ');
  throw new MetaSchemaError(what, detail);
}
