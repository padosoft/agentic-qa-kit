import { Badge } from '../components/Badge.tsx';
import { Card } from '../components/Card.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { MOCK_AGENTS } from '../data/mock.ts';

export function AgentsScreen() {
  return (
    <>
      <PageHeader
        title="Agents"
        subtitle="Detected agent-instruction files per supported coding agent."
      />
      <Card>
        <table className="w-full text-sm">
          <thead style={{ background: 'var(--color-bg-base)' }}>
            <tr style={{ color: 'var(--color-fg-muted)' }}>
              <th className="px-3 py-2 text-left font-medium">Agent</th>
              <th className="px-3 py-2 text-left font-medium">Instruction files</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {MOCK_AGENTS.map((a) => (
              <tr key={a.name} style={{ borderTop: '1px solid var(--color-border)' }}>
                <td className="px-3 py-2 font-medium">{a.name}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {a.files.map((f) => (
                      <code
                        key={f}
                        className="rounded px-1.5 py-0.5 text-xs"
                        style={{ background: 'var(--color-bg-base)' }}
                      >
                        {f}
                      </code>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <Badge tone={a.installed ? 'success' : 'neutral'}>
                    {a.installed ? 'installed' : 'not installed'}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
