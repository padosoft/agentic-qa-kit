import type {
  MethodologyApproval,
  MethodologyApprovalResult,
  MethodologyArtifactEnvelope,
  MethodologyProposal,
} from '@aqa/methodology';
import type {
  Agent,
  ApiToken,
  CostSummary,
  Event,
  Finding,
  Notification,
  PackManifest,
  Profile,
  RiskMap,
  Run,
  SavedView,
  Scenario,
  SsoConfig,
  Tenancy,
} from '@aqa/schemas';

// Directory entry for the admin's Users page — shared by every
// StoreProvider adapter so the store and admin agree on field names
// (`display_name`, `last_active_at`, etc.). PR #42 Copilot iter 2:
// extracted from inline-anon types in `listUsers` and `MemoryStore`.
export interface StoreUserDirectoryEntry {
  id: string;
  /** SCIM/OIDC directory login name; legacy snapshots may omit it. */
  user_name?: string;
  email: string;
  display_name: string;
  roles: Array<'viewer' | 'developer' | 'maintainer' | 'admin'>;
  status?: 'active' | 'invited' | 'suspended';
  last_active_at?: string;
}

export interface StoreScope {
  org?: string;
  project?: string;
}

export interface LegacyMigrationResult {
  migrated: number;
  skipped: number;
  conflicts: string[];
}

export interface MethodologyProposalRecord {
  proposal: MethodologyProposal;
  /** Bounded, DLP-checked payload staged for human review before approval. */
  artifact?: MethodologyArtifactEnvelope;
  approval?: MethodologyApproval;
}

/** Stable key namespace for tenant-scoped resources while preserving legacy keys. */
export function scopedRecordKey(key: string, scope?: StoreScope): string {
  if (!scope?.org && !scope?.project) return key;
  return `@scope/${encodeURIComponent(scope.org ?? '')}/${encodeURIComponent(scope.project ?? '')}/${key}`;
}

export function isScopedRecordKey(key: string): boolean {
  return key.startsWith('@scope/');
}

/**
 * Persistence boundary for the AQA stack. The runner persists runs +
 * events + findings (write side); the server uses the read methods to
 * power the admin and the public API.
 *
 * Adapters: `MemoryStore` (default, dev + tests), `PostgresStore`
 * (production). Adapters MUST honor the same semantics — tests share
 * fixtures across adapters.
 *
 * Multi-tenant note: methods that take an `org` / `project` filter MUST
 * apply it server-side. Passing `undefined` means "ignore that filter";
 * scoped reads never fall back to legacy unscoped records. Legacy records
 * remain visible only to an explicitly unscoped administrative migration.
 */
export interface StoreProvider {
  // ----- Runs -----
  saveRun(run: Run.Run): Promise<void>;
  loadRun(id: string): Promise<Run.Run | null>;
  listRuns(opts?: {
    org?: string;
    project?: string;
    profile?: string;
    state?: Run.Run['state'];
    limit?: number;
  }): Promise<Run.Run[]>;

  // ----- Events -----
  appendEvent(event: Event.Event): Promise<void>;
  listEvents(run_id: string): Promise<Event.Event[]>;
  /** Audit-log scoped listing — newest first. */
  listAuditEvents(opts: {
    org?: string;
    project?: string;
    kind?: Event.Event['kind'];
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<Event.Event[]>;

  // ----- Findings -----
  appendFinding(finding: Finding.Finding): Promise<void>;
  loadFinding(id: string): Promise<Finding.Finding | null>;
  updateFindingStatus(
    id: string,
    status: Finding.Finding['status'],
    actor: string,
    reason: string,
  ): Promise<Finding.Finding | null>;
  /** Atomically mutate a finding and append its status audit event. */
  transitionFindingStatus(
    id: string,
    status: Finding.Finding['status'],
    actor: string,
    reason: string,
  ): Promise<{ finding: Finding.Finding; event: Event.Event } | null>;
  /** Persist replay evidence and apply the deterministic fix/regression transition. */
  recordFindingVerification(
    id: string,
    verification: Finding.FindingVerification,
    actor: string,
  ): Promise<{ finding: Finding.Finding; event: Event.Event } | null>;
  listFindings(opts: {
    run_id?: string;
    severity?: Finding.Finding['severity'];
    status?: Finding.Finding['status'];
    limit?: number;
  }): Promise<Finding.Finding[]>;

  // ----- Packs -----
  listPacks(opts?: StoreScope): Promise<PackManifest.PackManifest[]>;
  loadPack(slug: string, scope?: StoreScope): Promise<PackManifest.PackManifest | null>;
  installPack(manifest: PackManifest.PackManifest, scope?: StoreScope): Promise<void>;
  uninstallPack(slug: string, scope?: StoreScope): Promise<void>;

  // ----- Profiles -----
  listProfiles(opts?: StoreScope): Promise<Profile.Profile[]>;
  loadProfile(name: string, scope?: StoreScope): Promise<Profile.Profile | null>;
  saveProfile(profile: Profile.Profile, scope?: StoreScope): Promise<void>;
  // Atomic create: { created: true } on insert, { created: false } if a
  // profile with the same name already exists. Used by POST /api/profiles
  // to avoid a TOCTOU race between loadProfile + saveProfile.
  createProfile(profile: Profile.Profile, scope?: StoreScope): Promise<{ created: boolean }>;
  deleteProfile(name: string, scope?: StoreScope): Promise<void>;

  // ----- Risk map -----
  listRisks(opts?: {
    org?: string;
    project?: string;
    category?: RiskMap.Risk['category'];
  }): Promise<RiskMap.Risk[]>;
  loadRisk(id: string, scope?: StoreScope): Promise<RiskMap.Risk | null>;
  saveRisk(risk: RiskMap.Risk, scope?: StoreScope): Promise<void>;
  deleteRisk(id: string, scope?: StoreScope): Promise<void>;

  // ----- Methodology artifacts -----
  /** List immutable, digest-bound methodology revisions in a tenant scope. */
  listMethodologyArtifacts(opts?: {
    org?: string;
    project?: string;
    artifact_kind?: MethodologyArtifactEnvelope['artifact_kind'];
  }): Promise<MethodologyArtifactEnvelope[]>;
  loadMethodologyArtifact(
    artifact_id: string,
    revision: number,
    scope?: StoreScope,
  ): Promise<MethodologyArtifactEnvelope | null>;
  /** Persist one revision; same revision + different digest is a hard conflict. */
  saveMethodologyArtifact(artifact: MethodologyArtifactEnvelope, scope?: StoreScope): Promise<void>;
  /** List pending/decided proposal records in a tenant scope. */
  listMethodologyProposals(opts?: {
    org?: string;
    project?: string;
    status?: MethodologyProposal['status'];
  }): Promise<MethodologyProposalRecord[]>;
  loadMethodologyProposal(
    proposalId: string,
    scope?: StoreScope,
  ): Promise<MethodologyProposalRecord | null>;
  /** Persist a proposal immutably; same id + same content is idempotent. */
  saveMethodologyProposal(
    proposal: MethodologyProposal,
    scope?: StoreScope,
    artifact?: MethodologyArtifactEnvelope,
  ): Promise<void>;
  /** Atomically approve one pending proposal and retain the approval record. */
  approveMethodologyProposal(
    proposalId: string,
    approval: MethodologyApproval,
    scope?: StoreScope,
  ): Promise<MethodologyApprovalResult | null>;

  // ----- Scenarios -----
  listScenarios(opts?: {
    pack?: string;
    risk_id?: string;
    org?: string;
    project?: string;
  }): Promise<Scenario.Scenario[]>;
  loadScenario(id: string, scope?: StoreScope): Promise<Scenario.Scenario | null>;
  saveScenario(scenario: Scenario.Scenario, scope?: StoreScope): Promise<void>;
  // Atomic create: { created: true } on insert, { created: false } if a
  // scenario with the same id already exists. Mirrors createProfile —
  // used by POST /api/scenarios to avoid a TOCTOU race between
  // loadScenario + saveScenario.
  createScenario(scenario: Scenario.Scenario, scope?: StoreScope): Promise<{ created: boolean }>;
  deleteScenario(id: string, scope?: StoreScope): Promise<void>;

  /** Explicitly assign legacy global configuration to one tenant namespace. */
  migrateLegacyConfiguration(scope: StoreScope): Promise<LegacyMigrationResult>;

  // ----- Agents (v1.7 slice 4d) -----
  listAgents(): Promise<Agent.Agent[]>;
  loadAgent(id: string): Promise<Agent.Agent | null>;
  // Safe to call repeatedly: marks installed=true and stamps
  // last_updated with the current time on every call. (Not strictly
  // idempotent because last_updated changes — but the observable
  // `installed` state converges.) Returns the resulting Agent so the
  // admin can correlate the response.
  installAgent(id: string): Promise<Agent.Agent | null>;
  // Idempotent uninstall: marks installed=false and leaves
  // last_updated alone as a record of the last install. Returns the
  // resulting Agent.
  uninstallAgent(id: string): Promise<Agent.Agent | null>;

  // ----- Notifications -----
  listNotifications(opts: {
    org: string;
    project?: string;
    unread_for?: string;
    limit?: number;
  }): Promise<Notification.Notification[]>;
  appendNotification(n: Notification.Notification): Promise<void>;
  markNotificationRead(id: string, user_id: string): Promise<void>;

  // ----- Saved views -----
  listSavedViews(opts: {
    org: string;
    project: string;
    surface: SavedView.SavedViewSurface;
    owner?: string;
  }): Promise<SavedView.SavedView[]>;
  saveSavedView(view: SavedView.SavedView): Promise<void>;
  deleteSavedView(id: string): Promise<void>;

  // ----- API tokens -----
  listTokens(opts: { org: string; owner?: string }): Promise<ApiToken.ApiToken[]>;
  createToken(token: ApiToken.ApiToken): Promise<void>;
  revokeToken(id: string, at: string): Promise<void>;

  // ----- Users (v1.7 slice 4g) -----
  // The admin's Users page reflects the identity provider's directory
  // (SSO/OIDC) — read-only from the store. A future slice can add
  // invite/role-change flows; for now `listUsers` is all the page
  // needs.
  listUsers(scope?: StoreScope): Promise<StoreUserDirectoryEntry[]>;
  /** Persist the latest IdP directory snapshot for an authenticated user. */
  upsertUser(user: StoreUserDirectoryEntry, scope?: StoreScope): Promise<void>;

  // ----- SSO config (slice 4h) -----
  // Backing config for the Admin SSO page. The secret is intentionally
  // not modeled as writable output from this method.
  loadSsoConfig(): Promise<SsoConfig.SsoConfig | null>;
  saveSsoConfig(config: SsoConfig.SsoConfig): Promise<void>;

  // ----- Tenancy -----
  listOrgs(): Promise<Tenancy.Org[]>;
  loadOrg(slug: string): Promise<Tenancy.Org | null>;
  saveOrg(org: Tenancy.Org): Promise<void>;
  listProjects(org: string): Promise<Tenancy.ProjectRef[]>;
  saveProject(project: Tenancy.ProjectRef): Promise<void>;

  // ----- Aggregations -----
  /** Compute the cost summary for the given window. */
  costSummary(opts: {
    org: string;
    project: string;
    from: string;
    to: string;
    budget_usd?: number;
  }): Promise<CostSummary.CostSummary>;

  close(): Promise<void>;
}
