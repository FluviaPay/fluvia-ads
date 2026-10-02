import { expect, it } from 'vitest';
import {
  DEFAULT_MESSAGE_DESTINATIONS,
  campaignTemplateSchema,
  categoryIdSchema,
  getTemplate,
  templates,
} from './index';

const all = Object.values(templates);

it('has a template for each of the 4 MVP categories, keyed by its own category', () => {
  expect(Object.keys(templates).sort()).toEqual([...categoryIdSchema.options].sort());
  for (const [key, t] of Object.entries(templates)) expect(t.category).toBe(key);
});

it('every template satisfies the schema', () => {
  for (const t of all) expect(() => campaignTemplateSchema.parse(t), t.category).not.toThrow();
});

it('every template is still provisional', () => {
  for (const t of all) expect(t.status, t.category).toBe('provisional');
});

it('defaults to whatsapp + instagram_direct', () => {
  expect(DEFAULT_MESSAGE_DESTINATIONS).toEqual(['whatsapp', 'instagram_direct']);
  for (const t of all)
    expect(t.messageDestinations, t.category).toEqual(DEFAULT_MESSAGE_DESTINATIONS);
});

it('uses sane budgets, ad counts and formats', () => {
  for (const t of all) {
    expect(t.dailyBudgetCop.min, t.category).toBeLessThanOrEqual(t.dailyBudgetCop.max);
    expect(Number.isInteger(t.dailyBudgetCop.min), t.category).toBe(true);
    expect(t.adCount, t.category).toBeGreaterThanOrEqual(1);
    expect(t.formats.length, t.category).toBeGreaterThan(0);
  }
});

it('getTemplate returns the template for a category', () => {
  expect(getTemplate('food').label).toBe('Comida');
});

it('rejects invalid configuration', () => {
  const base = getTemplate('beauty');
  const bad = (patch: object) => campaignTemplateSchema.safeParse({ ...base, ...patch }).success;

  expect(bad({})).toBe(true);
  expect(bad({ dailyBudgetCop: { min: 50_000, max: 10_000 } })).toBe(false);
  expect(bad({ dailyBudgetCop: { min: 1000.5, max: 2000 } })).toBe(false);
  expect(bad({ formats: ['1:1', '1:1'] })).toBe(false);
  expect(bad({ formats: ['16:9'] })).toBe(false);
  expect(bad({ formats: [] })).toBe(false);
  expect(bad({ messageDestinations: [] })).toBe(false);
  expect(bad({ objective: 'sales' })).toBe(false);
  expect(bad({ status: 'final' })).toBe(false);
  expect(bad({ unexpected: true })).toBe(false);
  expect(bad({ audience: { ...base.audience, ageMin: 60, ageMax: 30 } })).toBe(false);
});
