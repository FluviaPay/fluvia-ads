import { describe, expect, it } from 'vitest';
import { fixtureFiles } from '../fixtures';
import { SCENARIOS, fixtureSchema, loadFixture } from './index';

describe('fixtures', () => {
  it('has a file for every scenario, and each validates', () => {
    expect(Object.keys(fixtureFiles).sort()).toEqual([...SCENARIOS].sort());
    for (const scenario of SCENARIOS) {
      const fixture = loadFixture(scenario);
      expect(fixture.scenario, scenario).toBe(scenario);
    }
  });

  it('is explicitly marked synthetic until real recordings replace it', () => {
    for (const file of Object.values(fixtureFiles)) {
      expect(fixtureSchema.parse(file)._source).toBe('synthetic');
    }
  });

  it('only has lowercase header names', () => {
    for (const scenario of SCENARIOS) {
      const fixture = loadFixture(scenario);
      const all = [...fixture.responses.map((r) => r.response), fixture.fallback ?? []].flat();
      for (const response of all) {
        for (const name of Object.keys(response.headers)) expect(name).toBe(name.toLowerCase());
      }
    }
  });

  it('contains no real-looking secrets: only obviously fake MOCK_ tokens', () => {
    const text = JSON.stringify(fixtureFiles);
    expect(text).not.toMatch(/EAA[A-Za-z0-9]{20,}/);
    expect(text).not.toMatch(/"access_token":"(?!MOCK_)/);
    expect(text.toLowerCase()).not.toContain('bearer ');
  });

  it('covers the four required error scenarios', () => {
    expect(SCENARIOS).toEqual(
      expect.arrayContaining([
        'permission-denied',
        'rate-limited',
        'token-expired',
        'page-restricted',
      ]),
    );
  });
});
