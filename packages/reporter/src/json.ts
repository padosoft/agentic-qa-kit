import type { Finding, Run } from '@aqa/schemas';

export type ScenarioOutcome = 'pass' | 'fail' | 'error' | 'blocked' | 'not_run';
export interface ScenarioOutcomeSummary {
  scenario_id: string;
  outcome: ScenarioOutcome;
}

export interface JsonReportInput {
  run: Run.Run;
  findings: readonly Finding.Finding[];
  scenarioOutcomes?: readonly ScenarioOutcomeSummary[];
}

/** Stable JSON shape consumed by the admin UI and external dashboards. */
export interface JsonReport {
  schema_version: '1';
  generated_at: string;
  run: Run.Run;
  findings: readonly Finding.Finding[];
  scenario_outcomes: readonly ScenarioOutcomeSummary[];
  summary: {
    severities: Record<string, number>;
    total: number;
  };
}

export function renderJson(input: JsonReportInput, now: Date = new Date()): JsonReport {
  const severities: Record<string, number> = {};
  for (const f of input.findings) {
    severities[f.severity] = (severities[f.severity] ?? 0) + 1;
  }
  return {
    schema_version: '1',
    generated_at: now.toISOString(),
    run: input.run,
    findings: input.findings,
    scenario_outcomes: input.scenarioOutcomes ?? [],
    summary: { severities, total: input.findings.length },
  };
}
