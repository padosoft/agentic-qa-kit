import { Card, CardBody, CardHeader } from '../components/Card.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { MOCK_RUNS } from '../data/mock.ts';

export function CostScreen() {
  const byProfile = new Map<string, number>();
  for (const r of MOCK_RUNS) {
    byProfile.set(r.profile, (byProfile.get(r.profile) ?? 0) + r.cost_usd);
  }
  const total = [...byProfile.values()].reduce((a, b) => a + b, 0);
  const max = Math.max(...byProfile.values(), 0.0001);

  return (
    <>
      <PageHeader
        title="Cost"
        subtitle="LLM token + USD spend per profile. Hard cap enforced by @aqa/cost at request time."
      />
      <Card>
        <CardHeader>Spend by profile</CardHeader>
        <CardBody>
          <ul className="space-y-3">
            {[...byProfile].map(([profile, usd]) => {
              const pct = (usd / max) * 100;
              return (
                <li key={profile}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span>{profile}</span>
                    <span className="font-mono">${usd.toFixed(2)}</span>
                  </div>
                  <div
                    className="h-2 w-full overflow-hidden rounded"
                    style={{ background: 'var(--color-bg-base)' }}
                  >
                    <div
                      className="h-full"
                      style={{ width: `${pct}%`, background: 'var(--color-status-info)' }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
          <div
            className="mt-4 flex items-center justify-between border-t pt-3 text-sm"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <span style={{ color: 'var(--color-fg-muted)' }}>Total</span>
            <span className="font-mono font-semibold">${total.toFixed(2)}</span>
          </div>
        </CardBody>
      </Card>
    </>
  );
}
