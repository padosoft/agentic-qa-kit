import type { Finding, Run } from '@aqa/schemas';

export interface JsonReportInput {
  run: Run.Run;
  findings: readonly Finding.Finding[];
}

/** Stable JSON shape consumed by the admin UI and external dashboards. */
export interface JsonReport {
  schema_version: '1';
  generated_at: string;
  run: Run.Run;
  findings: readonly Finding.Finding[];
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
    summary: { severities, total: input.findings.length },
  };
}
