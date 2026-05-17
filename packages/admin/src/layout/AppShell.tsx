import type { ReactNode } from 'react';
import { SideNav } from './SideNav.tsx';
import { TopBar } from './TopBar.tsx';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen flex-col">
      <TopBar />
      <div className="grid flex-1 grid-cols-[240px_1fr] overflow-hidden">
        <SideNav />
        <main className="overflow-y-auto px-7 py-6">{children}</main>
      </div>
    </div>
  );
}
