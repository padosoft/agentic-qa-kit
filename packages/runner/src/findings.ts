import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { redactText } from '@aqa/observability';
import { Finding } from '@aqa/schemas';

export class FindingsWriter {
  private readonly path: string;
  private readonly seen = new Set<string>();
  private readonly findings: Finding.Finding[] = [];
  private readonly persist: boolean;

  constructor(path: string, opts: { persist?: boolean } = { persist: true }) {
    this.path = path;
    this.persist = opts.persist ?? true;
    if (this.persist) mkdirSync(dirname(path), { recursive: true });
  }

  /**
   * Append a finding to `.aqa/runs/<id>/findings.jsonl`. Dedup is keyed on
   * `(run_id, scenario_id, risk_id, severity)` — repeated identical findings
   * within the same run collapse into one. Cross-run dedup is the
   * findings-clustering task (v0.5).
   */
  append(finding: Finding.Finding): Finding.Finding | null {
    const dedupKey = `${finding.run_id}|${finding.scenario_id}|${finding.risk_id}|${finding.severity}`;
    if (this.seen.has(dedupKey)) return null;
    this.seen.add(dedupKey);
    const safeFinding = Finding.Finding.parse({
      ...finding,
      title: redactText(finding.title),
      summary: redactText(finding.summary),
      evidence: finding.evidence.map(redactText),
      tags: finding.tags.map(redactText),
    });
    this.findings.push(safeFinding);
    if (this.persist) appendFileSync(this.path, `${JSON.stringify(safeFinding)}\n`, 'utf8');
    return safeFinding;
  }

  snapshot(): readonly Finding.Finding[] {
    return this.findings;
  }
}
