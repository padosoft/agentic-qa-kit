import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { Badge, severityTone } from '../components/Badge.tsx';
import { Breadcrumb } from '../components/Breadcrumb.tsx';
import { Card, CardBody, CardHeader } from '../components/Card.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { fetchFindings, fetchRuns } from '../data/api.ts';

export function RunDetailScreen() {
  const { runId } = useParams({ strict: false }) as { runId: string };
  const {
    data: runs = [],
    isLoading: runsLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['runs'],
    queryFn: fetchRuns,
  });
  const { data: allFindings = [] } = useQuery({
    queryKey: ['findings'],
    queryFn: fetchFindings,
  });
  const run = runs.find((r) => r.id === runId);
  const findings = allFindings.filter((f) => f.run_id === runId);

  if (runsLoading) {
    return (
      <>
        <Breadcrumb items={[{ label: 'Runs', to: '/runs' }, { label: runId }]} />
        <PageHeader title={`Run ${runId}`} subtitle="Loading…" />
      </>
    );
  }

  if (isError) {
    return (
      <>
        <Breadcrumb items={[{ label: 'Runs', to: '/runs' }, { label: runId }]} />
        <PageHeader
          title={`Run ${runId}`}
          subtitle={`Live fetch failed: ${(error as Error).message}`}
        />
      </>
    );
  }

  if (!run) {
    return (
      <>
        <Breadcrumb items={[{ label: 'Runs', to: '/runs' }, { label: runId }]} />
        <PageHeader title={`Run ${runId}`} subtitle="Not found in current data source." />
      </>
    );
  }

  return (
    <>
      <Breadcrumb items={[{ label: 'Runs', to: '/runs' }, { label: run.id }]} />
      <PageHeader
        title={`Run ${run.id}`}
        subtitle={`Profile ${run.profile} · ${run.duration_s}s · $${run.cost_usd.toFixed(2)}`}
        actions={
          <Badge
            tone={
              run.status === 'completed' ? 'success' : run.status === 'failed' ? 'danger' : 'info'
            }
          >
            {run.status}
          </Badge>
        }
      />

      <div className="grid grid-cols-[1fr_280px] gap-4">
        <Card>
          <CardHeader>Findings emitted ({findings.length})</CardHeader>
          <CardBody>
            {findings.length === 0 ? (
              <p style={{ color: 'var(--color-fg-muted)' }}>No findings — clean run.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {findings.map((f) => (
                  <li key={f.id} className="flex items-center gap-2">
                    <Badge tone={severityTone(f.severity)}>{f.severity}</Badge>
                    <span className="font-mono text-xs" style={{ color: 'var(--color-fg-subtle)' }}>
                      {f.id}
                    </span>
                    <span className="flex-1 truncate">{f.summary}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>Metadata</CardHeader>
          <CardBody>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt style={{ color: 'var(--color-fg-muted)' }}>Started</dt>
              <dd className="font-mono text-xs">{run.started_at}</dd>
              <dt style={{ color: 'var(--color-fg-muted)' }}>Duration</dt>
              <dd className="font-mono">{run.duration_s}s</dd>
              <dt style={{ color: 'var(--color-fg-muted)' }}>Cost</dt>
              <dd className="font-mono">${run.cost_usd.toFixed(2)}</dd>
              <dt style={{ color: 'var(--color-fg-muted)' }}>Profile</dt>
              <dd>{run.profile}</dd>
            </dl>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
