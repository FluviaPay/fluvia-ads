import type { ErrorHandler, NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';
import type { AppEnv } from '../env';
import { log } from '../logger';

const CODES: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  429: 'rate_limited',
};

function errorBody(code: string, message: string, requestId: string, issues?: unknown) {
  return { error: { code, message, request_id: requestId, ...(issues ? { issues } : {}) } };
}

export const onError: ErrorHandler<AppEnv> = (err, c) => {
  const requestId = c.get('requestId') ?? 'unknown';

  if (err instanceof ZodError) {
    return c.json(errorBody('validation_error', 'Invalid request', requestId, err.issues), 400);
  }
  if (err instanceof HTTPException) {
    const code = CODES[err.status] ?? 'http_error';
    return c.json(errorBody(code, err.message, requestId), err.status as ContentfulStatusCode);
  }

  log('error', 'unhandled_error', { request_id: requestId, name: err.name, error: err.message });
  return c.json(errorBody('internal_error', 'Internal server error', requestId), 500);
};

export const notFound: NotFoundHandler<AppEnv> = (c) =>
  c.json(errorBody('not_found', 'Route not found', c.get('requestId') ?? 'unknown'), 404);
