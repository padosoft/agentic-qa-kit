import type { ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-md ${className}`}
      style={{
        background: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-border)',
      }}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children }: { children: ReactNode }) {
  return (
    <div
      className="border-b px-4 py-3 text-sm font-medium"
      style={{ borderColor: 'var(--color-border)' }}
    >
      {children}
    </div>
  );
}

export function CardBody({
  children,
  className = '',
}: { children: ReactNode; className?: string }) {
  return <div className={`px-4 py-3 ${className}`}>{children}</div>;
}
