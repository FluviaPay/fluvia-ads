import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { z } from 'zod';

/** Parses the JSON body; throws ZodError (-> 400 via onError) on invalid input. */
export async function parseBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: 'Invalid JSON body' });
  }
  return schema.parseAsync(raw);
}

export function parseQuery<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  return schema.parseAsync(c.req.query());
}
