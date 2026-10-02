import { expect, it } from 'vitest';
import { classifyMetaError } from './index';

it.each([
  [400, 190, 'auth'],
  [400, 4, 'rate_limited'],
  [400, 17, 'rate_limited'],
  [400, 613, 'rate_limited'],
  [400, 80004, 'rate_limited'],
  [403, 200, 'permission'],
  [400, 299, 'permission'],
  [400, 10, 'permission'],
  [400, 100, 'invalid_request'],
  [400, 368, 'policy'],
  [500, 2, 'transient'],
  [400, 1, 'transient'],
])('status %i code %i -> %s', (status, code, category) => {
  expect(classifyMetaError(status, code)).toBe(category);
});

it.each([
  [401, 'auth'],
  [403, 'permission'],
  [429, 'rate_limited'],
  [503, 'transient'],
  [400, 'unknown'],
])('falls back to the HTTP status %i -> %s when there is no known code', (status, category) => {
  expect(classifyMetaError(status)).toBe(category);
  expect(classifyMetaError(status, 999999)).toBe(category);
});
