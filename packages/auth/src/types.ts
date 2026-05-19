import { z } from 'zod';

export const Permission = z.enum([
  'runs:read',
  'runs:create',
  'findings:read',
  'findings:edit',
  'risk-map:read',
  'risk-map:edit',
  'profiles:read',
  'profiles:edit',
  'packs:read',
  'packs:install',
  // Pre-v1.7 the only agent permission was 'agents:install' — kept for
  // backwards compatibility. v1.7 slice 4d introduces split read/edit
  // permissions for the new /api/agents* routes.
  'agents:install',
  'agents:read',
  'agents:edit',
  'audit:read',
  'cost:read',
  'settings:read',
  'settings:edit',
  'admin:everything',
]);
export type Permission = z.infer<typeof Permission>;

export const Role = z.enum(['viewer', 'developer', 'maintainer', 'admin']);
export type Role = z.infer<typeof Role>;

export const User = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  display_name: z.string().min(1),
  roles: z.array(Role).min(1),
});
export type User = z.infer<typeof User>;

export const AuthSession = z.object({
  user: User,
  issued_at: z.string().datetime({ offset: true }),
  expires_at: z.string().datetime({ offset: true }),
});
export type AuthSession = z.infer<typeof AuthSession>;
