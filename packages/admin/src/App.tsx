import { useState } from 'react';
import { ScreenPlaceholder } from './ScreenPlaceholder.tsx';
import { ROUTES, type RouteKey } from './router.ts';

export function App() {
  const [active, setActive] = useState<RouteKey>('dashboard');
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '240px 1fr',
        gap: 0,
        minHeight: '100vh',
      }}
    >
      <aside
        style={{
          background: '#111',
          padding: '16px 12px',
          borderRight: '1px solid #1f1f1f',
        }}
      >
        <h1 style={{ fontSize: 14, margin: '4px 8px 16px', letterSpacing: '0.04em' }}>
          AQA <span style={{ color: '#a78bfa' }}>admin</span>
        </h1>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {ROUTES.map((r) => {
            const selected = r.key === active;
            return (
              <button
                type="button"
                key={r.key}
                onClick={() => setActive(r.key)}
                style={{
                  textAlign: 'left',
                  padding: '8px 10px',
                  fontSize: 13,
                  border: 0,
                  borderRadius: 6,
                  background: selected ? '#1f1f1f' : 'transparent',
                  color: selected ? '#fff' : '#a3a3a3',
                  cursor: 'pointer',
                }}
              >
                {r.label}
              </button>
            );
          })}
        </nav>
      </aside>
      <main style={{ padding: '24px 28px' }}>
        <ScreenPlaceholder routeKey={active} />
      </main>
    </div>
  );
}
