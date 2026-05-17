import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { Badge, severityTone } from '../components/Badge.tsx';
import { Breadcrumb } from '../components/Breadcrumb.tsx';
import { Card, CardBody, CardHeader } from '../components/Card.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { fetchFindings, fetchRisks } from '../data/api.ts';

export function RiskDetailScreen() {
  const { riskId } = useParams({ strict: false }) as { riskId: string };
  const { data: risks = [], isLoading } = useQuery({ queryKey: ['risks'], queryFn: fetchRisks });
  const { data: allFindings = [] } = useQuery({
    queryKey: ['findings'],
    queryFn: fetchFindings,
  });
  const r = risks.find((x) => x.id === riskId);
  const findings = allFindings.filter((f) => f.risk_id === riskId);

  if (isLoading) {
    return (
      <>
        <Breadcrumb items={[{ label: 'Risk map', to: '/risk-map' }, { label: riskId }]} />
        <PageHeader title={`Risk ${riskId}`} subtitle="Loading…" />
      </>
    );
  }

  if (!r) {
    return (
      <>
        <Breadcrumb items={[{ label: 'Risk map', to: '/risk-map' }, { label: riskId }]} />
        <PageHeader title={`Risk ${riskId}`} subtitle="Not found in current data source." />
      </>
    );
  }

  return (
    <>
      <Breadcrumb items={[{ label: 'Risk map', to: '/risk-map' }, { label: r.id }]} />
      <PageHeader
        title={r.title}
        subtitle={`Category: ${r.category}`}
        actions={<Badge tone={severityTone(r.severity)}>{r.severity}</Badge>}
      />

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader>Framework anchors</CardHeader>
          <CardBody>
            <div className="flex flex-wrap gap-1">
              {r.tags.length === 0 ? (
                <span style={{ color: 'var(--color-fg-muted)' }}>
                  No external anchors — auditor smell.
                </span>
              ) : (
                r.tags.map((t) => (
                  <Badge key={t} tone="info">
                    {t}
                  </Badge>
                ))
              )}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>Linked findings ({findings.length})</CardHeader>
          <CardBody>
            {findings.length === 0 ? (
              <p style={{ color: 'var(--color-fg-muted)' }}>None.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {findings.map((f) => (
                  <li key={f.id} className="flex items-center gap-2">
                    <Badge tone={severityTone(f.severity)}>{f.severity}</Badge>
                    <span className="font-mono text-xs">{f.id}</span>
                    <span className="truncate">{f.summary}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
