import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { Badge } from '../components/Badge.tsx';
import { Breadcrumb } from '../components/Breadcrumb.tsx';
import { Card, CardBody, CardHeader } from '../components/Card.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { fetchProfiles } from '../data/api.ts';

export function ProfileDetailScreen() {
  const { profileName } = useParams({ strict: false }) as { profileName: string };
  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ['profiles'],
    queryFn: fetchProfiles,
  });
  const p = profiles.find((x) => x.name === profileName);

  if (isLoading) {
    return (
      <>
        <Breadcrumb items={[{ label: 'Profiles', to: '/profiles' }, { label: profileName }]} />
        <PageHeader title={`Profile ${profileName}`} subtitle="Loading…" />
      </>
    );
  }

  if (!p) {
    return (
      <>
        <Breadcrumb items={[{ label: 'Profiles', to: '/profiles' }, { label: profileName }]} />
        <PageHeader title={`Profile ${profileName}`} subtitle="Not found in current data source." />
      </>
    );
  }

  return (
    <>
      <Breadcrumb items={[{ label: 'Profiles', to: '/profiles' }, { label: p.name }]} />
      <PageHeader
        title={p.name}
        subtitle={`${p.packs.length} packs · ${p.execution_mode} · $${p.budget_usd} budget`}
      />

      <Card>
        <CardHeader>Packs</CardHeader>
        <CardBody>
          <ul className="space-y-1">
            {p.packs.map((s) => (
              <li key={s} className="font-mono text-sm">
                <Badge tone="info">{s}</Badge>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </>
  );
}
