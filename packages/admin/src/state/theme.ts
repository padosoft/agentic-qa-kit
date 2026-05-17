import { create } from 'zustand';

type Mode = 'light' | 'dark';

function read(): Mode {
  if (typeof window === 'undefined') return 'dark';
  const stored = window.localStorage.getItem('aqa.theme') as Mode | null;
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'dark';
}

function applyToHtml(mode: Mode) {
  const html = document.documentElement;
  html.classList.toggle('dark', mode === 'dark');
}

interface ThemeState {
  mode: Mode;
  toggle: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => {
  const initial = read();
  if (typeof document !== 'undefined') applyToHtml(initial);
  return {
    mode: initial,
    toggle: () => {
      const next: Mode = get().mode === 'dark' ? 'light' : 'dark';
      window.localStorage.setItem('aqa.theme', next);
      applyToHtml(next);
      set({ mode: next });
    },
  };
});
