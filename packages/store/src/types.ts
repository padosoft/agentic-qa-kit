import type {
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
  Tenancy,
} from '@aqa/schemas';

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
