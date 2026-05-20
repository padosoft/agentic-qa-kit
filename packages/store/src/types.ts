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
  email: string;
  display_name: string;
  roles: Array<'viewer' | 'developer' | 'maintainer' | 'admin'>;
  status?: 'active' | 'invited' | 'suspended';
  last_active_at?: string;
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
 * absent fields on stored objects (legacy) are treated as matching any
 * tenant scope.
 */
export interface StoreProvider {
  // ----- Runs -----
  saveRun(run: Run.Run): Promise<void>;
  loadRun(id: string): Promise<Run.Run | null>;
  listRuns(opts?: {
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
  listFindings(opts: {
    run_id?: string;
    severity?: Finding.Finding['severity'];
    status?: Finding.Finding['status'];
    limit?: number;
  }): Promise<Finding.Finding[]>;

  // ----- Packs -----
  listPacks(opts?: { org?: string; project?: string }): Promise<PackManifest.PackManifest[]>;
  loadPack(slug: string): Promise<PackManifest.PackManifest | null>;
  installPack(manifest: PackManifest.PackManifest): Promise<void>;
  uninstallPack(slug: string): Promise<void>;

  // ----- Profiles -----
  listProfiles(opts?: { org?: string; project?: string }): Promise<Profile.Profile[]>;
  loadProfile(name: string): Promise<Profile.Profile | null>;
  saveProfile(profile: Profile.Profile): Promise<void>;
  // Atomic create: { created: true } on insert, { created: false } if a
  // profile with the same name already exists. Used by POST /api/profiles
  // to avoid a TOCTOU race between loadProfile + saveProfile.
  createProfile(profile: Profile.Profile): Promise<{ created: boolean }>;
  deleteProfile(name: string): Promise<void>;

  // ----- Risk map -----
  listRisks(opts?: {
    org?: string;
    project?: string;
    category?: RiskMap.Risk['category'];
  }): Promise<RiskMap.Risk[]>;
  loadRisk(id: string): Promise<RiskMap.Risk | null>;
  saveRisk(risk: RiskMap.Risk): Promise<void>;
  deleteRisk(id: string): Promise<void>;

  // ----- Scenarios -----
  listScenarios(opts?: {
    pack?: string;
    risk_id?: string;
  }): Promise<Scenario.Scenario[]>;
  loadScenario(id: string): Promise<Scenario.Scenario | null>;
  saveScenario(scenario: Scenario.Scenario): Promise<void>;
  // Atomic create: { created: true } on insert, { created: false } if a
  // scenario with the same id already exists. Mirrors createProfile —
  // used by POST /api/scenarios to avoid a TOCTOU race between
  // loadScenario + saveScenario.
  createScenario(scenario: Scenario.Scenario): Promise<{ created: boolean }>;
  deleteScenario(id: string): Promise<void>;

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
  listUsers(): Promise<StoreUserDirectoryEntry[]>;

  // ----- SSO config (slice 4h) -----
  // Backing config for the Admin SSO page. The secret is intentionally
  // not modeled as writable output from this method.
  loadSsoConfig(): Promise<SsoConfig.SsoConfig | null>;

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
