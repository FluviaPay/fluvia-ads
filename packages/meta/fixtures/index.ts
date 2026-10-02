import type { ScenarioName } from '../src/scenarios';
import happy from './happy.json';
import pageRestricted from './page-restricted.json';
import permissionDenied from './permission-denied.json';
import rateLimited from './rate-limited.json';
import tokenExpired from './token-expired.json';

/** Raw fixture files, validated against `fixtureSchema` when a mock transport is created. */
export const fixtureFiles: Record<ScenarioName, unknown> = {
  happy,
  'permission-denied': permissionDenied,
  'rate-limited': rateLimited,
  'token-expired': tokenExpired,
  'page-restricted': pageRestricted,
};
