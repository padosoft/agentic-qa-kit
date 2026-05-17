import { Card, CardBody, CardHeader } from '../components/Card.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { MOCK_PACKS } from '../data/mock.ts';

const TREE: Record<string, string[]> = {
  '@aqa/pack-security': [
    'sc-auth-bypass',
    'sc-cookie-flags',
    'sc-csrf-form',
    'sc-jwt-none-alg',
    'sc-idor-tenant',
  ],
  '@aqa/pack-api-core': [
    'sc-status-shape',
    'sc-cache-control',
    'sc-content-type-sniff',
    'sc-rate-limit-headers',
  ],
  '@aqa/pack-web-ui': ['sc-link-no-rel', 'sc-form-csrf', 'sc-clickjack-frame-options'],
};

export function ScenariosScreen() {
  return (
    <>
      <PageHeader
        title="Scenarios"
        subtitle="Pack → scenario tree. Click a scenario to view spec (deferred)."
      />
      <div className="grid grid-cols-2 gap-4">
        {MOCK_PACKS.map((p) => {
          const items = TREE[p.slug] ?? [];
          return (
            <Card key={p.slug}>
              <CardHeader>
                <span className="font-mono text-xs">{p.slug}</span>
              </CardHeader>
              <CardBody>
                {items.length === 0 ? (
                  <p className="text-xs" style={{ color: 'var(--color-fg-subtle)' }}>
                    No scenarios indexed for this pack.
                  </p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {items.map((s) => (
                      <li
                        key={s}
                        className="font-mono text-xs"
                        style={{ color: 'var(--color-fg-muted)' }}
                      >
                        ↳ {s}
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          );
        })}
      </div>
    </>
  );
}
