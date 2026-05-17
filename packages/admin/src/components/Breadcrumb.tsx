import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

export interface Crumb {
  label: string;
  to?: string;
}

export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav
      className="mb-3 flex items-center gap-1 text-xs"
      style={{ color: 'var(--color-fg-muted)' }}
    >
      {items.map((c, i) => (
        <BreadcrumbItem key={`${c.label}-${i}`} crumb={c} last={i === items.length - 1} />
      ))}
    </nav>
  );
}

function BreadcrumbItem({ crumb, last }: { crumb: Crumb; last: boolean }): ReactNode {
  const label = (
    <span style={{ color: last ? 'var(--color-fg-base)' : undefined }}>{crumb.label}</span>
  );
  return (
    <>
      {crumb.to && !last ? (
        // biome-ignore lint/suspicious/noExplicitAny: TanStack typed `to`; broad string here
        <Link to={crumb.to as any} className="hover:underline">
          {label}
        </Link>
      ) : (
        label
      )}
      {!last && <ChevronRight size={12} />}
    </>
  );
}
