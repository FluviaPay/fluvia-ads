import { expect, it } from 'vitest';
import {
  EXCLUDED_CATEGORY_IDS,
  classifyCategory,
  isCategoryAllowed,
  normalizeCategory,
} from './index';

it('lists the 7 excluded MVP categories', () => {
  expect([...EXCLUDED_CATEGORY_IDS].sort()).toEqual(
    ['banking', 'credit', 'employment', 'financial', 'health', 'housing', 'politics'].sort(),
  );
});

it('normalizes accents, case and punctuation', () => {
  expect(normalizeCategory('  Crédito, FÁCIL! ')).toBe('credito facil');
});

it('allows the four template categories in Spanish and English', () => {
  expect(classifyCategory('Belleza')).toEqual({ status: 'allowed', category: 'beauty' });
  expect(classifyCategory('comida')).toEqual({ status: 'allowed', category: 'food' });
  expect(classifyCategory('Ropa')).toEqual({ status: 'allowed', category: 'fashion' });
  expect(classifyCategory('servicios')).toEqual({ status: 'allowed', category: 'services' });
  expect(classifyCategory('fashion')).toEqual({ status: 'allowed', category: 'fashion' });
});

it.each([
  ['Crédito', 'credit'],
  ['préstamos rápidos', 'credit'],
  ['Financieras', 'financial'],
  ['Banca', 'banking'],
  ['Empleo', 'employment'],
  ['Vivienda', 'housing'],
  ['Política', 'politics'],
  ['campaña política', 'politics'],
  ['Salud', 'health'],
])('excludes %s', (input, reason) => {
  expect(classifyCategory(input)).toEqual({ status: 'excluded', reason });
  expect(isCategoryAllowed(input)).toBe(false);
});

it('excluded wins over allowed', () => {
  expect(classifyCategory('Servicios de salud')).toEqual({ status: 'excluded', reason: 'health' });
});

it('does not match keywords inside other words', () => {
  expect(classifyCategory('bancarrota')).toEqual({ status: 'unknown' });
});

it('treats unknown and empty input as not allowed', () => {
  expect(classifyCategory('Criptomonedas')).toEqual({ status: 'unknown' });
  expect(classifyCategory('   ')).toEqual({ status: 'unknown' });
  expect(isCategoryAllowed('Criptomonedas')).toBe(false);
  expect(isCategoryAllowed('Belleza')).toBe(true);
});
