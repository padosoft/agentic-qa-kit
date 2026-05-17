import { Bell, Search, ShieldCheck, User } from 'lucide-react';
import { useThemeStore } from '../state/theme.ts';

export function TopBar() {
  const { mode, toggle } = useThemeStore();
  return (
    <header
      className="flex h-12 items-center justify-between border-b px-4"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-elevated)' }}
    >
      <div className="flex items-center gap-3">
        <ShieldCheck size={20} style={{ color: 'var(--color-status-ai)' }} />
        <span className="font-semibold text-sm">AQA admin</span>
        <span
          className="rounded px-1.5 py-0.5 text-xs"
          style={{ background: 'var(--color-border)', color: 'var(--color-fg-muted)' }}
        >
          padosoft / agentic-qa-kit
        </span>
      </div>
      <div className="flex flex-1 items-center justify-center">
        <div
          className="flex w-96 items-center gap-2 rounded px-3 py-1.5 text-sm"
          style={{ background: 'var(--color-bg-base)', border: '1px solid var(--color-border)' }}
        >
          <Search size={14} style={{ color: 'var(--color-fg-subtle)' }} />
          <input
            type="search"
            placeholder="Search runs, findings, scenarios… (⌘K)"
            className="flex-1 bg-transparent outline-none"
            style={{ color: 'var(--color-fg-base)' }}
          />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          className="rounded px-2 py-1 text-xs"
          style={{ border: '1px solid var(--color-border)', color: 'var(--color-fg-muted)' }}
          aria-label="Toggle theme"
        >
          {mode === 'dark' ? 'Dark' : 'Light'}
        </button>
        <Bell size={16} style={{ color: 'var(--color-fg-muted)' }} />
        <User size={16} style={{ color: 'var(--color-fg-muted)' }} />
      </div>
    </header>
  );
}
