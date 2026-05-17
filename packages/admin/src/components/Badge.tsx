import type { ReactNode } from 'react';

const TONES = {
  neutral: { bg: 'var(--color-border)', fg: 'var(--color-fg-muted)' },
  info: { bg: 'rgba(14,165,233,0.15)', fg: 'var(--color-status-info)' },
  success: { bg: 'rgba(16,185,129,0.15)', fg: 'var(--color-status-success)' },
  warning: { bg: 'rgba(245,158,11,0.15)', fg: 'var(--color-status-warning)' },
  danger: { bg: 'rgba(244,63,94,0.15)', fg: 'var(--color-status-danger)' },
  ai: { bg: 'rgba(139,92,246,0.15)', fg: 'var(--color-status-ai)' },
} as const;

export type BadgeTone = keyof typeof TONES;

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  const t = TONES[tone];
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium"
      style={{ background: t.bg, color: t.fg }}
    >
      {children}
    </span>
  );
}

export function severityTone(sev: string): BadgeTone {
  if (sev === 'critical') return 'danger';
  if (sev === 'high') return 'warning';
  if (sev === 'medium') return 'warning';
  if (sev === 'low') return 'success';
  return 'neutral';
}
