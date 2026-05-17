import { ShieldCheck } from 'lucide-react';
import { Badge } from '../components/Badge.tsx';
import { Card } from '../components/Card.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { MOCK_PACKS } from '../data/mock.ts';

export function PacksScreen() {
  return (
    <>
      <PageHeader
        title="Packs"
        subtitle="Installed packs — slug, version, signature, scenario/risk count."
      />
      <Card>
        <table className="w-full text-sm">
          <thead style={{ background: 'var(--color-bg-base)' }}>
            <tr style={{ color: 'var(--color-fg-muted)' }}>
              <th className="px-3 py-2 text-left font-medium">Pack</th>
              <th className="px-3 py-2 text-left font-medium">Version</th>
              <th className="px-3 py-2 text-left font-medium">Signature</th>
              <th className="px-3 py-2 text-right font-medium">Scenarios</th>
              <th className="px-3 py-2 text-right font-medium">Risks</th>
            </tr>
          </thead>
          <tbody>
            {MOCK_PACKS.map((p) => (
              <tr key={p.slug} style={{ borderTop: '1px solid var(--color-border)' }}>
                <td className="px-3 py-2 font-mono text-xs">{p.slug}</td>
                <td className="px-3 py-2 font-mono">{p.version}</td>
                <td className="px-3 py-2">
                  {p.signed ? (
                    <span className="inline-flex items-center gap-1">
                      <ShieldCheck size={14} style={{ color: 'var(--color-status-success)' }} />
                      <Badge tone="success">signed</Badge>
                    </span>
                  ) : (
                    <Badge tone="danger">unsigned</Badge>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-mono">{p.scenarios}</td>
                <td className="px-3 py-2 text-right font-mono">{p.risks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
