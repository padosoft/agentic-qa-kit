import { Badge, severityTone } from '../components/Badge.tsx';
import { Card, CardBody, CardHeader } from '../components/Card.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { MOCK_RISKS } from '../data/mock.ts';

export function RiskMapScreen() {
  const byCategory = new Map<string, typeof MOCK_RISKS>();
  for (const r of MOCK_RISKS) {
    const arr = byCategory.get(r.category) ?? [];
    arr.push(r);
    byCategory.set(r.category, arr);
  }
  return (
    <>
      <PageHeader
        title="Risk map"
        subtitle="Read-only view grouped by category. Editing lands via OptimisticEditor in a follow-up."
      />
      <div className="grid grid-cols-2 gap-4">
        {[...byCategory].map(([cat, risks]) => (
          <Card key={cat}>
            <CardHeader>
              <span className="capitalize">{cat}</span>
              <span className="ml-2 text-xs" style={{ color: 'var(--color-fg-subtle)' }}>
                {risks.length} risk{risks.length > 1 ? 's' : ''}
              </span>
            </CardHeader>
            <CardBody>
              <ul className="space-y-2 text-sm">
                {risks.map((r) => (
                  <li key={r.id} className="flex items-start gap-2">
                    <Badge tone={severityTone(r.severity)}>{r.severity}</Badge>
                    <span className="font-mono text-xs" style={{ color: 'var(--color-fg-subtle)' }}>
                      {r.id}
                    </span>
                    <span className="flex-1">{r.title}</span>
                    <span className="flex gap-1">
                      {r.tags.map((t) => (
                        <Badge key={t} tone="info">
                          {t}
                        </Badge>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ))}
      </div>
    </>
  );
}
