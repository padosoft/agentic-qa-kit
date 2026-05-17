import { Link, useRouterState } from '@tanstack/react-router';
import {
  Activity,
  AlertOctagon,
  Bot,
  DollarSign,
  FileSearch,
  Layers,
  LayoutDashboard,
  Map as MapIcon,
  Package,
  PlayCircle,
  Settings,
  Sliders,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { ROUTES, type RouteKey } from '../router.ts';

const ICONS: Record<RouteKey, ComponentType<{ size?: number }>> = {
  dashboard: LayoutDashboard,
  runs: Activity,
  findings: AlertOctagon,
  'risk-map': MapIcon,
  profiles: Sliders,
  packs: Package,
  scenarios: Layers,
  agents: Bot,
  replay: PlayCircle,
  audit: FileSearch,
  cost: DollarSign,
  settings: Settings,
};

export function SideNav() {
  const { location } = useRouterState();
  const active = location.pathname;
  return (
    <aside
      className="flex flex-col gap-0.5 overflow-y-auto py-3"
      style={{
        background: 'var(--color-bg-elevated)',
        borderRight: '1px solid var(--color-border)',
      }}
    >
      {ROUTES.map((r) => {
        const Icon = ICONS[r.key];
        const selected = active === r.path;
        return (
          <Link
            key={r.key}
            to={r.path}
            className="mx-2 flex items-center gap-2.5 rounded px-2.5 py-1.5 text-sm transition-colors"
            style={{
              background: selected ? 'var(--color-bg-base)' : 'transparent',
              color: selected ? 'var(--color-fg-base)' : 'var(--color-fg-muted)',
              borderLeft: selected ? '2px solid var(--color-status-info)' : '2px solid transparent',
            }}
          >
            <Icon size={14} />
            <span>{r.label}</span>
          </Link>
        );
      })}
      <div className="mt-auto px-3 py-3 text-xs" style={{ color: 'var(--color-fg-subtle)' }}>
        v1.2.0 · GA
      </div>
    </aside>
  );
}
