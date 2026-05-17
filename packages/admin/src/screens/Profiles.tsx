import { Badge } from '../components/Badge.tsx';
import { Card } from '../components/Card.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { MOCK_PROFILES } from '../data/mock.ts';

export function ProfilesScreen() {
  return (
    <>
      <PageHeader title="Profiles" subtitle=".aqa/profiles.yaml — packs, execution mode, budget." />
      <Card>
        <table className="w-full text-sm">
          <thead style={{ background: 'var(--color-bg-base)' }}>
            <tr style={{ color: 'var(--color-fg-muted)' }}>
              <th className="px-3 py-2 text-left font-medium">Name</th>
              <th className="px-3 py-2 text-left font-medium">Packs</th>
              <th className="px-3 py-2 text-left font-medium">Mode</th>
              <th className="px-3 py-2 text-right font-medium">Budget</th>
            </tr>
          </thead>
          <tbody>
            {MOCK_PROFILES.map((p) => (
              <tr key={p.name} style={{ borderTop: '1px solid var(--color-border)' }}>
                <td className="px-3 py-2 font-mono">{p.name}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {p.packs.map((s) => (
                      <Badge key={s} tone="info">
                        {s.replace('@aqa/pack-', '')}
                      </Badge>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <Badge tone={p.execution_mode === 'sandbox' ? 'success' : 'warning'}>
                    {p.execution_mode}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-right font-mono">${p.budget_usd}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
