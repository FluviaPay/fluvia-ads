import { z } from 'zod';
import { fixtureFiles } from '../../fixtures';
import { SCENARIOS, type ScenarioName } from '../scenarios';
import type { MetaRequest, MetaResponse, MetaTransport } from '../transport';

const responseSchema = z.object({
  status: z.number().int(),
  headers: z.record(z.string(), z.string()),
  body: z.unknown(),
});

export const fixtureSchema = z.object({
  /** `synthetic` until replaced by real recordings from the Meta sandbox. */
  _source: z.enum(['synthetic', 'recorded']),
  scenario: z.enum(SCENARIOS),
  description: z.string(),
  /** Unmatched requests fall through to the happy scenario. */
  extends: z.literal('happy').optional(),
  responses: z.array(
    z.object({
      match: z.object({ method: z.enum(['GET', 'POST', 'DELETE']), path: z.string() }),
      response: responseSchema,
    }),
  ),
  /** Answers every request that has no specific response (used by the error scenarios). */
  fallback: responseSchema.optional(),
});
export type Fixture = z.infer<typeof fixtureSchema>;

export function loadFixture(scenario: ScenarioName): Fixture {
  return fixtureSchema.parse(fixtureFiles[scenario]);
}

/** `*` matches exactly one path segment (or the rest of a segment, e.g. `act_*`). */
function matches(pattern: string, path: string): boolean {
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]+');
  return new RegExp(`^${source}$`).test(path);
}

function find(fixture: Fixture, req: MetaRequest): MetaResponse | undefined {
  const hit = fixture.responses.find(
    (entry) => entry.match.method === req.method && matches(entry.match.path, req.path),
  );
  return hit?.response;
}

export function createMockTransport(scenario: ScenarioName): MetaTransport {
  const fixture = loadFixture(scenario);
  const base = fixture.extends ? loadFixture(fixture.extends) : undefined;

  return async (req) => {
    const response = find(fixture, req) ?? fixture.fallback ?? (base ? find(base, req) : undefined);
    if (response) return structuredClone(response);
    return {
      status: 400,
      headers: {},
      body: {
        error: {
          message: `No fixture for ${req.method} ${req.path} in scenario "${scenario}"`,
          type: 'MockFixtureError',
          code: 100,
        },
      },
    };
  };
}
