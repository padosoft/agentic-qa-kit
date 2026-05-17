import { PlayCircle } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../components/Badge.tsx';
import { Card, CardBody, CardHeader } from '../components/Card.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { MOCK_FINDINGS } from '../data/mock.ts';

export function ReplayScreen() {
  const [selected, setSelected] = useState(MOCK_FINDINGS[0]?.id ?? '');
  const f = MOCK_FINDINGS.find((x) => x.id === selected);
  return (
    <>
      <PageHeader
        title="Replay"
        subtitle="Pick a finding and inspect its 3-level reproducibility artifacts (repro.sh / repro.curl / repro.playwright.ts)."
      />
      <div className="grid grid-cols-[260px_1fr] gap-4">
        <Card>
          <CardHeader>Findings</CardHeader>
          <CardBody>
            <ul className="space-y-1 text-sm">
              {MOCK_FINDINGS.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(m.id)}
                    className="w-full rounded px-2 py-1 text-left text-xs"
                    style={{
                      background: selected === m.id ? 'var(--color-bg-base)' : 'transparent',
                      color: selected === m.id ? 'var(--color-fg-base)' : 'var(--color-fg-muted)',
                    }}
                  >
                    <span className="font-mono">{m.id}</span> · {m.severity}
                  </button>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <div className="space-y-3">
          {f && (
            <>
              <Card>
                <CardHeader>
                  <span className="font-mono text-xs">{f.id}</span>
                  <span className="ml-2">
                    <Badge tone="info">floor {f.verification_floor}</Badge>
                  </span>
                </CardHeader>
                <CardBody>
                  <p className="mb-2 text-sm font-medium">{f.summary}</p>
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded px-3 py-1.5 text-xs font-medium"
                    style={{ background: 'var(--color-status-info)', color: 'white' }}
                  >
                    <PlayCircle size={14} /> aqa verify {f.id}
                  </button>
                </CardBody>
              </Card>

              <Card>
                <CardHeader>repro.sh</CardHeader>
                <CardBody>
                  <pre
                    className="overflow-auto rounded p-3 text-xs"
                    style={{ background: 'var(--color-bg-base)' }}
                  >
                    {`#!/usr/bin/env bash
set -euo pipefail
aqa replay --finding ${f.id} --level L${f.verification_floor.replace('L', '')}`}
                  </pre>
                </CardBody>
              </Card>

              <Card>
                <CardHeader>repro.curl</CardHeader>
                <CardBody>
                  <pre
                    className="overflow-auto rounded p-3 text-xs"
                    style={{ background: 'var(--color-bg-base)' }}
                  >
                    {`curl -sS -X POST \\
  http://localhost:3000/api/admin \\
  -H "Authorization: Bearer <unsigned-jwt>" \\
  -d '{"action":"delete-user","id":"u-1"}'`}
                  </pre>
                </CardBody>
              </Card>
            </>
          )}
        </div>
      </div>
    </>
  );
}
