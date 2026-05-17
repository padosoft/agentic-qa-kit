import { Card, CardBody, CardHeader } from '../components/Card.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { useThemeStore } from '../state/theme.ts';

export function SettingsScreen() {
  const { mode, toggle } = useThemeStore();
  return (
    <>
      <PageHeader title="Settings" subtitle="Per-user UI preferences. No SUT mutations." />
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader>Theme</CardHeader>
          <CardBody>
            <p className="mb-3 text-sm" style={{ color: 'var(--color-fg-muted)' }}>
              Current: <strong>{mode}</strong>. Stored in <code>localStorage.aqa.theme</code>.
            </p>
            <button
              type="button"
              onClick={toggle}
              className="rounded px-3 py-1.5 text-sm font-medium"
              style={{ background: 'var(--color-status-info)', color: 'white' }}
            >
              Switch to {mode === 'dark' ? 'light' : 'dark'}
            </button>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>About</CardHeader>
          <CardBody>
            <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
              <dt style={{ color: 'var(--color-fg-muted)' }}>Version</dt>
              <dd className="font-mono">v1.2.0</dd>
              <dt style={{ color: 'var(--color-fg-muted)' }}>Bundle</dt>
              <dd className="font-mono">Vite 6 + React 19 + Tailwind 4</dd>
              <dt style={{ color: 'var(--color-fg-muted)' }}>Routing</dt>
              <dd className="font-mono">TanStack Router</dd>
              <dt style={{ color: 'var(--color-fg-muted)' }}>State</dt>
              <dd className="font-mono">TanStack Query · Zustand</dd>
            </dl>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
