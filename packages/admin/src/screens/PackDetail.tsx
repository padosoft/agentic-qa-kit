import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { Badge } from '../components/Badge.tsx';
import { Breadcrumb } from '../components/Breadcrumb.tsx';
import { Card, CardBody, CardHeader } from '../components/Card.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { fetchPacks } from '../data/api.ts';

export function PackDetailScreen() {
  const { packSlug } = useParams({ strict: false }) as { packSlug: string };
  const slug = decodeURIComponent(packSlug);
  const { data: packs = [], isLoading } = useQuery({ queryKey: ['packs'], queryFn: fetchPacks });
  const p = packs.find((x) => x.slug === slug);

  if (isLoading) {
    return (
      <>
        <Breadcrumb items={[{ label: 'Packs', to: '/packs' }, { label: slug }]} />
        <PageHeader title={`Pack ${slug}`} subtitle="Loading…" />
      </>
    );
  }

  if (!p) {
    return (
      <>
        <Breadcrumb items={[{ label: 'Packs', to: '/packs' }, { label: slug }]} />
        <PageHeader title={`Pack ${slug}`} subtitle="Not found in current data source." />
      </>
    );
  }

  return (
    <>
      <Breadcrumb items={[{ label: 'Packs', to: '/packs' }, { label: p.slug }]} />
      <PageHeader
        title={p.slug}
        subtitle={`v${p.version}`}
        actions={
          p.signed ? <Badge tone="success">signed</Badge> : <Badge tone="danger">unsigned</Badge>
        }
      />

      <Card>
        <CardHeader>Manifest summary</CardHeader>
        <CardBody>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt style={{ color: 'var(--color-fg-muted)' }}>Scenarios</dt>
            <dd className="font-mono">{p.scenarios}</dd>
            <dt style={{ color: 'var(--color-fg-muted)' }}>Risks declared</dt>
            <dd className="font-mono">{p.risks}</dd>
            <dt style={{ color: 'var(--color-fg-muted)' }}>Signature</dt>
            <dd>{p.signed ? 'cosign-compatible' : '—'}</dd>
          </dl>
        </CardBody>
      </Card>
    </>
  );
}
