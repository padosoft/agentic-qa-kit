import { useQuery } from '@tanstack/react-query';
import { Badge, severityTone } from '../components/Badge.tsx';
import { Card, CardBody, CardHeader } from '../components/Card.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { clusterFindings } from '../data/cluster.ts';
import { MOCK_FINDINGS } from '../data/mock.ts';

export function FindingsScreen() {
  const { data: clusters, isLoading } = useQuery({
    queryKey: ['findings-clusters'],
    queryFn: () => clusterFindings(MOCK_FINDINGS),
  });

  return (
    <>
      <PageHeader
        title="Findings"
        subtitle="Clustered by content-hash signature (scenario × risk × normalised summary). Same content across runs collapses into one cluster."
      />
      {isLoading && (
        <Card>
          <CardBody>Clustering…</CardBody>
        </Card>
      )}
      {clusters && (
        <div className="space-y-3">
          {clusters.map((c) => (
            <Card key={c.signature}>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Badge tone={severityTone(c.worst_severity)}>{c.worst_severity}</Badge>
                  <span className="font-mono text-xs" style={{ color: 'var(--color-fg-subtle)' }}>
                    sig:{c.signature.slice(0, 12)}…
                  </span>
                  <span className="ml-auto text-xs" style={{ color: 'var(--color-fg-muted)' }}>
                    {c.count} finding{c.count > 1 ? 's' : ''}
                  </span>
                </div>
              </CardHeader>
              <CardBody>
                <div className="mb-2 text-sm font-medium">{c.representative.summary}</div>
                <div className="text-xs" style={{ color: 'var(--color-fg-muted)' }}>
                  scenario <code className="font-mono">{c.representative.scenario_id}</code> · risk{' '}
                  <code className="font-mono">{c.representative.risk_id}</code> · floor{' '}
                  <Badge tone="info">{c.representative.verification_floor}</Badge>
                </div>
                <ul className="mt-3 space-y-1 text-xs">
                  {c.members.map((m) => (
                    <li
                      key={m.id}
                      className="flex items-center gap-2"
                      style={{ color: 'var(--color-fg-muted)' }}
                    >
                      <span className="font-mono">{m.id}</span>
                      <span>·</span>
                      <span>{m.run_id}</span>
                      <span>·</span>
                      <Badge
                        tone={
                          m.status === 'verified'
                            ? 'success'
                            : m.status === 'fixed'
                              ? 'info'
                              : 'warning'
                        }
                      >
                        {m.status}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
