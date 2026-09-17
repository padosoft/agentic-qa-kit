import type { Role, User } from './types.js';

export interface MfaPolicy {
  enabled: boolean;
  /** If omitted, every interactive user is subject to the policy. */
  required_roles?: ReadonlyArray<Role>;
}

export function mfaRequired(user: User, policy: MfaPolicy | undefined): boolean {
  if (!policy?.enabled) return false;
  if (!policy.required_roles || policy.required_roles.length === 0) return true;
  return user.roles.some((role) => policy.required_roles?.includes(role));
}

/** Fail closed when a policy-covered user lacks an IdP-asserted MFA factor. */
export function enforceMfa(user: User, policy: MfaPolicy | undefined): User {
  if (mfaRequired(user, policy) && user.mfa_verified !== true)
    throw new Error('[auth/mfa] multi-factor authentication is required');
  return user;
}
