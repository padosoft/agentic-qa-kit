import { useParams } from '@tanstack/react-router';
import { Breadcrumb } from '../components/Breadcrumb.tsx';
import { Card, CardBody, CardHeader } from '../components/Card.tsx';
import { PageHeader } from '../components/PageHeader.tsx';

export function ScenarioDetailScreen() {
  const { scenarioId } = useParams({ strict: false }) as { scenarioId: string };

  return (
    <>
      <Breadcrumb items={[{ label: 'Scenarios', to: '/scenarios' }, { label: scenarioId }]} />
      <PageHeader
        title={scenarioId}
        subtitle="Scenario spec (read-only). Live YAML editor is admin-core territory."
      />

      <Card>
        <CardHeader>Spec preview</CardHeader>
        <CardBody>
          <pre
            className="overflow-auto rounded p-3 text-xs"
            style={{ background: 'var(--color-bg-base)' }}
          >
            {`schema_version: "1"
id: ${scenarioId}
risk_id: r-auth-001
applies_when:
  target.type: api
probe:
  kind: http
  method: POST
  path: /api/admin
  headers:
    Authorization: "Bearer ${'{{ unsigned_jwt }}'}"
oracle:
  kind: status
  expected: 401
verification_floor: high
`}
          </pre>
        </CardBody>
      </Card>
    </>
  );
}
