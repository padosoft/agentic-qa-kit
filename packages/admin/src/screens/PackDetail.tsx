import { useParams } from '@tanstack/react-router';
import { Badge } from '../components/Badge.tsx';
import { Breadcrumb } from '../components/Breadcrumb.tsx';
import { Card, CardBody, CardHeader } from '../components/Card.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { MOCK_PACKS } from '../data/mock.ts';

export function PackDetailScreen() {
  const { packSlug } = useParams({ strict: false }) as { packSlug: string };
  const slug = decodeURIComponent(packSlug);
  const p = MOCK_PACKS.find((x) => x.slug === slug);

  if (!p) {
    return (
      <>
        <Breadcrumb items={[{ label: 'Packs', to: '/packs' }, { label: slug }]} />
        <PageHeader title={`Pack ${slug}`} subtitle="Not found." />
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
