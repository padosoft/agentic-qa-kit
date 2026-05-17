import type { Finding, Run } from '@aqa/schemas';

export interface MarkdownReportInput {
  run: Run.Run;
  findings: readonly Finding.Finding[];
}

const SEVERITY_RANK: Record<Finding.Finding['severity'], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function fmtMoney(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

export function renderMarkdown(input: MarkdownReportInput): string {
  const { run, findings } = input;
  const sorted = [...findings].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );
  const counts: Record<string, number> = {};
  for (const f of sorted) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  const summary = (['critical', 'high', 'medium', 'low', 'info'] as const)
    .map((s) => `${counts[s] ?? 0} ${s}`)
    .join(' · ');
  const lines: string[] = [];
  lines.push(`# AQA report — \`${run.project}\``);
  lines.push('');
  lines.push(`**Run** \`${run.id}\` · **Profile** \`${run.profile}\` · **State** \`${run.state}\``);
  lines.push(
    `**Started** ${run.started_at}${run.finished_at ? ` · **Finished** ${run.finished_at}` : ''}`,
  );
  lines.push(
    `**Totals** scenarios=${run.totals.scenarios} probes=${run.totals.probes} findings=${run.totals.findings} · llm cost=${fmtMoney(
      run.totals.llm_cost_usd,
    )} (in=${run.totals.llm_tokens_in}, out=${run.totals.llm_tokens_out})`,
  );
  lines.push('');
  lines.push(`## Findings — ${summary}`);
  lines.push('');
  if (sorted.length === 0) {
    lines.push('_No findings._');
    return `${lines.join('\n')}\n`;
  }
  for (const f of sorted) {
    lines.push(`### ${f.id} · ${f.severity.toUpperCase()} · ${f.title}`);
    lines.push('');
    lines.push(`- **scenario** \`${f.scenario_id}\`  **risk** \`${f.risk_id}\``);
    lines.push(
      `- **status** \`${f.status}\` · **execution_mode** \`${f.execution_mode}\` · **verification floor** \`${f.verification_floor}\``,
    );
    lines.push(`- **confidence** ${f.confidence.toFixed(2)} · **discovered** ${f.discovered_at}`);
    lines.push('');
    lines.push(f.summary);
    lines.push('');
    if (f.evidence.length > 0) {
      lines.push('Evidence:');
      for (const e of f.evidence) lines.push(`- \`${e}\``);
      lines.push('');
    }
  }
  return `${lines.join('\n')}\n`;
}
