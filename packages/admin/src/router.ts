export interface Route {
  key: RouteKey;
  label: string;
  path: string;
}

export const ROUTES = [
  { key: 'dashboard', label: 'Dashboard', path: '/' },
  { key: 'runs', label: 'Runs', path: '/runs' },
  { key: 'findings', label: 'Findings', path: '/findings' },
  { key: 'risk-map', label: 'Risk map', path: '/risk-map' },
  { key: 'profiles', label: 'Profiles', path: '/profiles' },
  { key: 'packs', label: 'Packs', path: '/packs' },
  { key: 'scenarios', label: 'Scenarios', path: '/scenarios' },
  { key: 'agents', label: 'Agents', path: '/agents' },
  { key: 'replay', label: 'Replay', path: '/replay' },
  { key: 'audit', label: 'Audit log', path: '/audit' },
  { key: 'cost', label: 'Cost', path: '/cost' },
  { key: 'settings', label: 'Settings', path: '/settings' },
] as const;

export type RouteKey = (typeof ROUTES)[number]['key'];
