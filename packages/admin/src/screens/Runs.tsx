import { formatDistanceToNow } from 'date-fns';
import { Badge } from '../components/Badge.tsx';
import { Card } from '../components/Card.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { MOCK_RUNS } from '../data/mock.ts';

export function RunsScreen() {
  return (
    <>
      <PageHeader title="Runs" subtitle="Every run with status, duration, findings, cost." />
      <Card>
        <table className="w-full text-sm">
          <thead style={{ background: 'var(--color-bg-base)' }}>
            <tr style={{ color: 'var(--color-fg-muted)' }}>
              <th className="px-3 py-2 text-left font-medium">ID</th>
              <th className="px-3 py-2 text-left font-medium">Profile</th>
              <th className="px-3 py-2 text-left font-medium">Started</th>
              <th className="px-3 py-2 text-right font-medium">Duration</th>
              <th className="px-3 py-2 text-right font-medium">Findings</th>
              <th className="px-3 py-2 text-right font-medium">Cost</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {MOCK_RUNS.map((r) => (
              <tr key={r.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                <td className="px-3 py-2 font-mono text-xs">{r.id}</td>
                <td className="px-3 py-2">{r.profile}</td>
                <td className="px-3 py-2" style={{ color: 'var(--color-fg-muted)' }}>
                  {formatDistanceToNow(new Date(r.started_at), { addSuffix: true })}
                </td>
                <td className="px-3 py-2 text-right font-mono">{r.duration_s}s</td>
                <td className="px-3 py-2 text-right font-mono">{r.findings}</td>
                <td className="px-3 py-2 text-right font-mono">${r.cost_usd.toFixed(2)}</td>
                <td className="px-3 py-2">
                  <Badge
                    tone={
                      r.status === 'completed'
                        ? 'success'
                        : r.status === 'failed'
                          ? 'danger'
                          : 'info'
                    }
                  >
                    {r.status}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
