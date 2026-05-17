import type { Permission, Role, User } from './types.js';

export type PermissionName = Permission;
export type RoleName = Role;

/**
 * Default role → permission mapping. Override at deployment time by replacing
 * the constant or wiring the matrix into the operator's identity provider.
 *
 * - viewer: read-only everywhere except settings.
 * - developer: viewer + can create runs and edit findings/risk-map.
 * - maintainer: developer + can edit profiles + install packs/agents.
 * - admin: every permission, including settings:edit and `admin:everything`.
 */
export const rolePermissions: Record<Role, ReadonlyArray<Permission>> = {
  viewer: [
    'runs:read',
    'findings:read',
    'risk-map:read',
    'profiles:read',
    'packs:read',
    'audit:read',
    'cost:read',
    'settings:read',
  ],
  developer: [
    'runs:read',
    'runs:create',
    'findings:read',
    'findings:edit',
    'risk-map:read',
    'risk-map:edit',
    'profiles:read',
    'packs:read',
    'audit:read',
    'cost:read',
    'settings:read',
  ],
  maintainer: [
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
    'agents:install',
    'audit:read',
    'cost:read',
    'settings:read',
  ],
  admin: ['admin:everything'],
};

/** Does the user hold the given permission via any of their roles? */
export function allows(user: User, need: Permission): boolean {
  for (const role of user.roles) {
    const perms = rolePermissions[role];
    if (perms.includes('admin:everything')) return true;
    if (perms.includes(need)) return true;
  }
  return false;
}
