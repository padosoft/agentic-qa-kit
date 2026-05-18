import { Activity, AlertOctagon, DollarSign, ShieldCheck } from 'lucide-react';
import { Badge, severityTone } from '../components/Badge.tsx';
import { Card, CardBody, CardHeader } from '../components/Card.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { MOCK_FINDINGS, MOCK_RUNS } from '../data/mock.ts';

function Kpi({
  icon: Icon,
  label,
  value,
  tone = 'neutral',
}: { icon: typeof Activity; label: string; value: string; tone?: string }) {
  return (
    <Card>
      <CardBody className="flex items-center gap-3">
        <div
          className="grid h-10 w-10 place-items-center rounded"
          style={{ background: 'var(--color-bg-base)', color: 'var(--color-status-info)' }}
        >
          <Icon size={18} />
        </div>
        <div>
          <div className="text-xs" style={{ color: 'var(--color-fg-muted)' }}>
            {label}
          </div>
          <div className="font-mono font-semibold text-lg">{value}</div>
        </div>
        {tone === 'ai' && <Badge tone="ai">AI</Badge>}
      </CardBody>
    </Card>
  );
}

export function DashboardScreen() {
  const runs = MOCK_RUNS;
  const findings = MOCK_FINDINGS;
  const completed = runs.filter((r) => r.status === 'completed').length;
  const open = findings.filter((f) => f.status === 'draft').length;
  const cost = runs.reduce((acc, r) => acc + r.cost_usd, 0);
  const lastRun = runs[runs.length - 1];

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Snapshot of recent runs, open findings, spend." />

      <div className="grid grid-cols-4 gap-4">
        <Kpi icon={Activity} label="Runs (24h)" value={String(runs.length)} />
        <Kpi icon={ShieldCheck} label="Completed" value={String(completed)} />
        <Kpi icon={AlertOctagon} label="Open findings" value={String(open)} />
        <Kpi icon={DollarSign} label="Spend (USD)" value={`$${cost.toFixed(2)}`} />
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4">
        <Card>
          <CardHeader>Last run</CardHeader>
          <CardBody>
            {lastRun ? (
              <div className="grid grid-cols-2 gap-y-2 text-sm">
                <span style={{ color: 'var(--color-fg-muted)' }}>ID</span>
                <span className="font-mono">{lastRun.id}</span>
                <span style={{ color: 'var(--color-fg-muted)' }}>Profile</span>
                <span>{lastRun.profile}</span>
                <span style={{ color: 'var(--color-fg-muted)' }}>Status</span>
                <span>
                  <Badge
                    tone={
                      lastRun.status === 'completed'
                        ? 'success'
                        : lastRun.status === 'failed'
                          ? 'danger'
                          : 'info'
                    }
                  >
                    {lastRun.status}
                  </Badge>
                </span>
                <span style={{ color: 'var(--color-fg-muted)' }}>Findings</span>
                <span>{lastRun.findings}</span>
              </div>
            ) : (
              <p style={{ color: 'var(--color-fg-muted)' }}>No runs yet.</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>Top findings</CardHeader>
          <CardBody>
            <ul className="space-y-2 text-sm">
              {findings.slice(0, 4).map((f) => (
                <li key={f.id} className="flex items-center gap-2">
                  <Badge tone={severityTone(f.severity)}>{f.severity}</Badge>
                  <span className="font-mono text-xs" style={{ color: 'var(--color-fg-subtle)' }}>
                    {f.id}
                  </span>
                  <span className="truncate">{f.summary}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
