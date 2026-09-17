import { randomUUID } from 'node:crypto';
import type { Role } from './types.js';

export interface ScimUserResource {
  id?: string;
  userName: string;
  displayName?: string;
  active?: boolean;
  name?: { formatted?: string; givenName?: string; familyName?: string };
  emails?: Array<{ value: string; primary?: boolean; type?: string }>;
  roles?: Array<{ value: string }>;
}

export interface ScimDirectoryUser {
  id: string;
  external_id?: string;
  user_name: string;
  email: string;
  display_name: string;
  roles: Role[];
  active: boolean;
  tenant: string;
  updated_at: string;
}

export interface ScimDirectory {
  get(tenant: string, id: string): Promise<ScimDirectoryUser | null>;
  list(tenant: string, filter?: string): Promise<ScimDirectoryUser[]>;
  put(user: ScimDirectoryUser): Promise<void>;
  remove(tenant: string, id: string): Promise<void>;
}

export class ScimValidationError extends Error {
  constructor(message: string) {
    super(`[auth/scim] ${message}`);
    this.name = 'ScimValidationError';
  }
}

/** Tenant-bound SCIM 2.0 resource operations; persistence is injected. */
export class ScimProvisioner {
  constructor(
    private readonly directory: ScimDirectory,
    private readonly tenant: string,
  ) {
    if (!tenant.trim()) throw new ScimValidationError('tenant is required');
  }

  async create(resource: ScimUserResource): Promise<ScimDirectoryUser> {
    const user = this.normalize(resource);
    const existing = await this.directory.list(this.tenant, `userName eq "${user.user_name}"`);
    if (existing.length > 0) throw new ScimValidationError('userName already exists');
    await this.directory.put(user);
    return user;
  }

  async replace(id: string, resource: ScimUserResource): Promise<ScimDirectoryUser> {
    const current = await this.require(id);
    const user = { ...this.normalize(resource), id: current.id, tenant: this.tenant };
    await this.directory.put(user);
    return user;
  }

  async patch(
    id: string,
    operations: ReadonlyArray<ScimPatchOperation>,
  ): Promise<ScimDirectoryUser> {
    const current = await this.require(id);
    const next: ScimUserResource = {
      id: current.id,
      userName: current.user_name,
      displayName: current.display_name,
      active: current.active,
      emails: [{ value: current.email, primary: true }],
      roles: current.roles.map((value) => ({ value })),
    };
    for (const operation of operations) applyPatch(next, operation);
    return this.replace(id, next);
  }

  async deactivate(id: string): Promise<void> {
    const current = await this.require(id);
    await this.directory.put({ ...current, active: false, updated_at: new Date().toISOString() });
  }

  async get(id: string): Promise<ScimDirectoryUser> {
    return this.require(id);
  }

  list(filter?: string): Promise<ScimDirectoryUser[]> {
    return this.directory.list(this.tenant, filter);
  }

  private async require(id: string): Promise<ScimDirectoryUser> {
    if (!id.trim()) throw new ScimValidationError('resource id is required');
    const user = await this.directory.get(this.tenant, id);
    if (!user || user.tenant !== this.tenant) throw new ScimValidationError('resource not found');
    return user;
  }

  private normalize(resource: ScimUserResource): ScimDirectoryUser {
    const email =
      resource.emails?.find((entry) => entry.primary)?.value ?? resource.emails?.[0]?.value;
    if (!resource.userName.trim()) throw new ScimValidationError('userName is required');
    if (!email || !/^\S+@\S+\.\S+$/.test(email))
      throw new ScimValidationError('a valid email is required');
    const id = resource.id?.trim() || `scim-${randomUUID()}`;
    const displayName =
      resource.displayName?.trim() || resource.name?.formatted?.trim() || resource.userName.trim();
    const roles = (resource.roles ?? [])
      .map((role) => role.value)
      .filter(
        (role): role is Role =>
          role === 'viewer' || role === 'developer' || role === 'maintainer' || role === 'admin',
      );
    return {
      id,
      user_name: resource.userName.trim(),
      email,
      display_name: displayName,
      roles: roles.length ? roles : ['viewer'],
      active: resource.active ?? true,
      tenant: this.tenant,
      updated_at: new Date().toISOString(),
    };
  }
}

export interface ScimPatchOperation {
  op: 'add' | 'replace' | 'remove';
  path?: string;
  value?: unknown;
}

function applyPatch(resource: ScimUserResource, operation: ScimPatchOperation): void {
  const path = operation.path?.toLowerCase();
  if (path === 'active') {
    if (operation.op === 'remove') resource.active = false;
    else if (typeof operation.value !== 'boolean')
      throw new ScimValidationError('active must be boolean');
    else resource.active = operation.value;
    return;
  }
  if (path === 'displayname') {
    if (operation.op === 'remove') resource.displayName = '';
    else if (typeof operation.value !== 'string')
      throw new ScimValidationError('displayName must be string');
    else resource.displayName = operation.value;
    return;
  }
  throw new ScimValidationError(`unsupported patch path: ${operation.path ?? '<root>'}`);
}
