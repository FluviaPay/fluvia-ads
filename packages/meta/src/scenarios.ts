export const SCENARIOS = [
  'happy',
  'permission-denied',
  'rate-limited',
  'token-expired',
  'page-restricted',
] as const;

export type ScenarioName = (typeof SCENARIOS)[number];
