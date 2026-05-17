import { useParams } from '@tanstack/react-router';
import { Badge, severityTone } from '../components/Badge.tsx';
import { Breadcrumb } from '../components/Breadcrumb.tsx';
import { Card, CardBody, CardHeader } from '../components/Card.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { MOCK_FINDINGS } from '../data/mock.ts';

export function FindingDetailScreen() {
  const { findingId } = useParams({ strict: false }) as { findingId: string };
  const f = MOCK_FINDINGS.find((x) => x.id === findingId);

  if (!f) {
    return (
      <>
        <Breadcrumb items={[{ label: 'Findings', to: '/findings' }, { label: findingId }]} />
        <PageHeader title={`Finding ${findingId}`} subtitle="Not found." />
      </>
    );
  }

  return (
    <>
      <Breadcrumb items={[{ label: 'Findings', to: '/findings' }, { label: f.id }]} />
      <PageHeader
        title={f.summary}
        subtitle={`${f.scenario_id} · ${f.risk_id}`}
        actions={
          <>
            <Badge tone={severityTone(f.severity)}>{f.severity}</Badge>
            <Badge tone="info">floor {f.verification_floor}</Badge>
          </>
        }
      />

      <Card>
        <CardHeader>Trace</CardHeader>
        <CardBody>
          <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-sm">
            <dt style={{ color: 'var(--color-fg-muted)' }}>Run</dt>
            <dd className="font-mono">{f.run_id}</dd>
            <dt style={{ color: 'var(--color-fg-muted)' }}>Scenario</dt>
            <dd className="font-mono">{f.scenario_id}</dd>
            <dt style={{ color: 'var(--color-fg-muted)' }}>Risk</dt>
            <dd className="font-mono">{f.risk_id}</dd>
            <dt style={{ color: 'var(--color-fg-muted)' }}>Status</dt>
            <dd>
              <Badge
                tone={
                  f.status === 'verified' ? 'success' : f.status === 'fixed' ? 'info' : 'warning'
                }
              >
                {f.status}
              </Badge>
            </dd>
            <dt style={{ color: 'var(--color-fg-muted)' }}>Created</dt>
            <dd className="font-mono text-xs">{f.created_at}</dd>
          </dl>
        </CardBody>
      </Card>
    </>
  );
}
