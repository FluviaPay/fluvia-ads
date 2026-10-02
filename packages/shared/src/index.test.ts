import { expect, it } from 'vitest';
import { packageName } from './index';

it('exports its package name', () => {
  expect(packageName).toBe('@fluvia/shared');
});
