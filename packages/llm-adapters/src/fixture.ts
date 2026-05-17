import { createHash } from 'node:crypto';
import type { LlmAdapter, LlmCallInput, LlmCallOutput } from './types.js';

export interface Fixture {
  key: string;
  output: LlmCallOutput;
}

/**
 * Compute a stable key from the LLM call so the FixtureAdapter can lookup
 * recorded responses by content rather than insertion order. Sorting object
 * keys + hashing keeps the key stable across re-emissions.
 */
export function makeFixtureKey(input: LlmCallInput): string {
  const stable = JSON.stringify(input, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.keys(v as object)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = (v as Record<string, unknown>)[k];
          return acc;
        }, {});
    }
    return v;
  });
  return createHash('sha256').update(stable).digest('hex');
}

/**
 * FixtureAdapter — replays recorded responses in CI so LLM-dependent code
 * stays deterministic. Live calls only happen behind an explicit env flag
 * inside the production adapters (Task 16 follow-up).
 */
export class FixtureAdapter implements LlmAdapter {
  public readonly provider = 'fixture' as const;
  private readonly map: Map<string, LlmCallOutput>;

  constructor(fixtures: readonly Fixture[]) {
    this.map = new Map();
    for (const f of fixtures) this.map.set(f.key, f.output);
  }

  async call(input: LlmCallInput): Promise<LlmCallOutput> {
    const key = makeFixtureKey(input);
    const out = this.map.get(key);
    if (!out) {
      throw new Error(
        `[llm-adapters/fixture] no recorded response for key ${key.slice(0, 12)}…. Record one or capture a fixture before re-running.`,
      );
    }
    return out;
  }
}
