import { MetaInputError } from '../errors';

export function numericId(value: string, name: string): string {
  if (!/^\d+$/.test(value)) throw new MetaInputError(`${name} must be a numeric Meta id`);
  return value;
}

/** Accepts `123` or `act_123` and returns `act_123`. */
export function adAccountId(value: string, name: string): string {
  const match = /^(?:act_)?(\d+)$/.exec(value);
  if (!match) throw new MetaInputError(`${name} must be a numeric ad account id`);
  return `act_${match[1]}`;
}
