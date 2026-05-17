import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '../components/Badge.tsx';
import { Card, CardBody, CardHeader } from '../components/Card.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { buildMockChain, parseEventLines, verifyEventChain } from '../data/audit.ts';

export function AuditScreen() {
  const { data: mock } = useQuery({ queryKey: ['mock-chain'], queryFn: buildMockChain });
  const [text, setText] = useState('');
  useEffect(() => {
    if (mock && !text) setText(mock.good);
  }, [mock, text]);

  const verify = useMutation({
    mutationFn: async (raw: string) => {
      const events = parseEventLines(raw);
      return verifyEventChain(events);
    },
  });

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Hash-chained events.jsonl viewer. Paste a chain and verify in-browser (Web Crypto). The same algorithm runs in the aqa-audit-verify CLI."
      />

      <div className="grid grid-cols-[1fr_320px] gap-4">
        <Card>
          <CardHeader>Paste / inspect events.jsonl</CardHeader>
          <CardBody>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="h-72 w-full rounded p-3 font-mono text-xs"
              style={{
                background: 'var(--color-bg-base)',
                color: 'var(--color-fg-base)',
                border: '1px solid var(--color-border)',
              }}
              spellCheck={false}
            />
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => verify.mutate(text)}
                className="rounded px-3 py-1.5 text-sm font-medium"
                style={{ background: 'var(--color-status-info)', color: 'white' }}
              >
                Verify chain
              </button>
              <button
                type="button"
                onClick={() => mock && setText(mock.good)}
                className="rounded px-3 py-1.5 text-sm"
                style={{ border: '1px solid var(--color-border)', color: 'var(--color-fg-muted)' }}
              >
                Load good chain
              </button>
              <button
                type="button"
                onClick={() => mock && setText(mock.tampered)}
                className="rounded px-3 py-1.5 text-sm"
                style={{ border: '1px solid var(--color-border)', color: 'var(--color-fg-muted)' }}
              >
                Load tampered chain
              </button>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>Result</CardHeader>
          <CardBody>
            {verify.isIdle && (
              <p className="text-sm" style={{ color: 'var(--color-fg-muted)' }}>
                Press <strong>Verify chain</strong> to re-walk the sha256 chain.
              </p>
            )}
            {verify.isPending && <p className="text-sm">Verifying…</p>}
            {verify.data?.ok && (
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <CheckCircle2 size={18} style={{ color: 'var(--color-status-success)' }} />
                  <Badge tone="success">CHAIN OK</Badge>
                </div>
                <p className="text-sm">
                  Verified {verify.data.count} record{verify.data.count > 1 ? 's' : ''} end-to-end.
                </p>
              </div>
            )}
            {verify.data && !verify.data.ok && (
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <ShieldAlert size={18} style={{ color: 'var(--color-status-danger)' }} />
                  <Badge tone="danger">CHAIN BROKEN</Badge>
                </div>
                <p className="text-sm">
                  First bad record at index <strong>#{verify.data.bad_index}</strong>.
                </p>
                <p className="mt-1 text-xs" style={{ color: 'var(--color-fg-muted)' }}>
                  {verify.data.reason}
                </p>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
