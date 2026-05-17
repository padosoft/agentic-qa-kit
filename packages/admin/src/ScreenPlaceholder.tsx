import type { RouteKey } from './router.ts';

const COPY: Record<RouteKey, { title: string; body: string }> = {
  dashboard: { title: 'Dashboard', body: 'KPIs, last run, top findings.' },
  runs: {
    title: 'Runs',
    body: 'Tabular history of every run with state, duration, cost, findings count.',
  },
  findings: { title: 'Findings', body: 'Kanban grouped by status × severity. Drag-drop in v0.4.' },
  'risk-map': {
    title: 'Risk map',
    body: 'Read-only at v0.1.0 — edits land in the Risk Editor pass.',
  },
  profiles: {
    title: 'Profiles',
    body: 'View .aqa/profiles.yaml entries with budget + execution_mode.',
  },
  packs: { title: 'Packs', body: 'Installed packs, applies_when status, last update.' },
  scenarios: { title: 'Scenarios', body: 'Tree by pack × risk. Read-only viewer at v0.1.0.' },
  agents: { title: 'Agents', body: 'Discovered per-agent instruction files + skill manifests.' },
  replay: { title: 'Replay', body: 'Stream output of `aqa replay <finding-id>` against the SUT.' },
  audit: {
    title: 'Audit log',
    body: 'Hash-chained events.jsonl viewer with chain verification badge.',
  },
  cost: { title: 'Cost', body: 'LLM token + USD spend per run, per profile, per project.' },
  settings: {
    title: 'Settings',
    body: 'Per-user UI preferences (theme, density). No SUT mutations.',
  },
};

export function ScreenPlaceholder({ routeKey }: { routeKey: RouteKey }) {
  const c = COPY[routeKey];
  return (
    <section>
      <h2 style={{ fontSize: 20, margin: '0 0 8px' }}>{c.title}</h2>
      <p style={{ color: '#a3a3a3', maxWidth: 720 }}>{c.body}</p>
      <p style={{ color: '#737373', marginTop: 32, fontSize: 12 }}>
        Placeholder — wired UI lands in Task 7 follow-ups per{' '}
        <code>docs/design/admin-panel-template.md</code>.
      </p>
    </section>
  );
}
