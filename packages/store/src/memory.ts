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
import type { StoreProvider } from './types.js';

/**
 * In-memory StoreProvider — the v0.3 default. Useful for tests, smoke runs,
 * and developer-local profiles. Drops everything on `close()`. The Postgres
 * adapter has identical semantics and tests share fixtures.
 */
export class MemoryStore implements StoreProvider {
  private runs = new Map<string, Run.Run>();
  private events = new Map<string, Event.Event[]>();
  private audit: Event.Event[] = [];
  private findings = new Map<string, Finding.Finding>();
  private packs = new Map<string, PackManifest.PackManifest>();
  private profiles = new Map<string, Profile.Profile>();
  private risks = new Map<string, RiskMap.Risk>();
  private scenarios = new Map<string, Scenario.Scenario>();
  private notifications: Notification.Notification[] = [];
  private savedViews = new Map<string, SavedView.SavedView>();
  private tokens = new Map<string, ApiToken.ApiToken>();
  private orgs = new Map<string, Tenancy.Org>();
  private projects = new Map<string, Tenancy.ProjectRef>();

  // ----- Runs -----
  async saveRun(run: Run.Run): Promise<void> {
    this.runs.set(run.id, run);
  }
  async loadRun(id: string): Promise<Run.Run | null> {
    return this.runs.get(id) ?? null;
  }
  async listRuns(
    opts: {
      project?: string;
      profile?: string;
      state?: Run.Run['state'];
      limit?: number;
    } = {},
  ): Promise<Run.Run[]> {
    let out = [...this.runs.values()];
    if (opts.project) out = out.filter((r) => r.project === opts.project);
    if (opts.profile) out = out.filter((r) => r.profile === opts.profile);
    if (opts.state) out = out.filter((r) => r.state === opts.state);
    out.sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
    return typeof opts.limit === 'number' ? out.slice(0, opts.limit) : out;
  }

  // ----- Events -----
  async appendEvent(event: Event.Event): Promise<void> {
    if ('run_id' in event && typeof (event as { run_id?: unknown }).run_id === 'string') {
      const run_id = (event as { run_id: string }).run_id;
      const bucket = this.events.get(run_id) ?? [];
      bucket.push(event);
      this.events.set(run_id, bucket);
    }
    this.audit.push(event);
  }
  async listEvents(run_id: string): Promise<Event.Event[]> {
    return [...(this.events.get(run_id) ?? [])];
  }
  async listAuditEvents(opts: {
    org?: string;
    project?: string;
    kind?: Event.Event['kind'];
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<Event.Event[]> {
    let out = [...this.audit];
    if (opts.kind) out = out.filter((e) => e.kind === opts.kind);
    const from = opts.from;
    const to = opts.to;
    if (from) out = out.filter((e) => e.ts >= from);
    if (to) out = out.filter((e) => e.ts <= to);
    // Tenant filtering: Event has no top-level tenant fields. The runner
    // event writer does not yet inject org/project into the payload, so
    // most events are "global" (no tenant tag). Be lenient: drop only
    // events that carry an EXPLICITLY DIFFERENT tenant tag. Events
    // without payload.org / payload.project pass through.
    const org = opts.org;
    const project = opts.project;
    if (org) {
      out = out.filter((e) => {
        const tag = (e.payload as { org?: string }).org;
        return tag === undefined || tag === org;
      });
    }
    if (project) {
      out = out.filter((e) => {
        const tag = (e.payload as { project?: string }).project;
        return tag === undefined || tag === project;
      });
    }
    out.sort((a, b) => (a.ts < b.ts ? 1 : -1));
    return typeof opts.limit === 'number' ? out.slice(0, opts.limit) : out;
  }

  // ----- Findings -----
  async appendFinding(finding: Finding.Finding): Promise<void> {
    this.findings.set(finding.id, finding);
  }
  async loadFinding(id: string): Promise<Finding.Finding | null> {
    return this.findings.get(id) ?? null;
  }
  async updateFindingStatus(
    id: string,
    status: Finding.Finding['status'],
    _actor: string,
    _reason: string,
  ): Promise<Finding.Finding | null> {
    const f = this.findings.get(id);
    if (!f) return null;
    const updated = { ...f, status } as Finding.Finding;
    this.findings.set(id, updated);
    return updated;
  }
  async listFindings(opts: {
    run_id?: string;
    severity?: Finding.Finding['severity'];
    status?: Finding.Finding['status'];
    limit?: number;
  }): Promise<Finding.Finding[]> {
    let out = [...this.findings.values()];
    if (opts.run_id) out = out.filter((f) => f.run_id === opts.run_id);
    if (opts.severity) out = out.filter((f) => f.severity === opts.severity);
    if (opts.status) out = out.filter((f) => f.status === opts.status);
    return typeof opts.limit === 'number' ? out.slice(0, opts.limit) : out;
  }

  // ----- Packs -----
  async listPacks(): Promise<PackManifest.PackManifest[]> {
    return [...this.packs.values()];
  }
  async loadPack(slug: string): Promise<PackManifest.PackManifest | null> {
    return this.packs.get(slug) ?? null;
  }
  async installPack(manifest: PackManifest.PackManifest): Promise<void> {
    this.packs.set(manifest.name, manifest);
  }
  async uninstallPack(slug: string): Promise<void> {
    this.packs.delete(slug);
  }

  // ----- Profiles -----
  async listProfiles(): Promise<Profile.Profile[]> {
    return [...this.profiles.values()];
  }
  async loadProfile(name: string): Promise<Profile.Profile | null> {
    return this.profiles.get(name) ?? null;
  }
  async saveProfile(profile: Profile.Profile): Promise<void> {
    this.profiles.set(profile.name, profile);
  }
  async createProfile(profile: Profile.Profile): Promise<{ created: boolean }> {
    // `has` + `set` runs synchronously between awaits, so two concurrent
    // callers can't both observe "missing" and overwrite each other.
    if (this.profiles.has(profile.name)) return { created: false };
    this.profiles.set(profile.name, profile);
    return { created: true };
  }
  async deleteProfile(name: string): Promise<void> {
    this.profiles.delete(name);
  }

  // ----- Risks -----
  async listRisks(
    opts: {
      org?: string;
      project?: string;
      category?: RiskMap.Risk['category'];
    } = {},
  ): Promise<RiskMap.Risk[]> {
    let out = [...this.risks.values()];
    if (opts.category) out = out.filter((r) => r.category === opts.category);
    return out;
  }
  async loadRisk(id: string): Promise<RiskMap.Risk | null> {
    return this.risks.get(id) ?? null;
  }
  async saveRisk(risk: RiskMap.Risk): Promise<void> {
    this.risks.set(risk.id, risk);
  }
  async deleteRisk(id: string): Promise<void> {
    this.risks.delete(id);
  }

  // ----- Scenarios -----
  async listScenarios(
    opts: { pack?: string; risk_id?: string } = {},
  ): Promise<Scenario.Scenario[]> {
    let out = [...this.scenarios.values()];
    const riskId = opts.risk_id;
    if (riskId) out = out.filter((s) => s.risk_refs.includes(riskId));
    return out;
  }
  async loadScenario(id: string): Promise<Scenario.Scenario | null> {
    return this.scenarios.get(id) ?? null;
  }
  async saveScenario(scenario: Scenario.Scenario): Promise<void> {
    this.scenarios.set(scenario.id, scenario);
  }

  // ----- Notifications -----
  async listNotifications(opts: {
    org: string;
    project?: string;
    unread_for?: string;
    limit?: number;
  }): Promise<Notification.Notification[]> {
    let out = this.notifications.filter((n) => n.org === opts.org);
    if (opts.project) out = out.filter((n) => n.project === opts.project);
    const unreadFor = opts.unread_for;
    if (unreadFor) out = out.filter((n) => !n.read_by.includes(unreadFor));
    out.sort((a, b) => (a.at < b.at ? 1 : -1));
    return typeof opts.limit === 'number' ? out.slice(0, opts.limit) : out;
  }
  async appendNotification(n: Notification.Notification): Promise<void> {
    this.notifications.push(n);
  }
  async markNotificationRead(id: string, user_id: string): Promise<void> {
    const n = this.notifications.find((x) => x.id === id);
    if (n && !n.read_by.includes(user_id)) n.read_by.push(user_id);
  }

  // ----- Saved views -----
  async listSavedViews(opts: {
    org: string;
    project: string;
    surface: SavedView.SavedViewSurface;
    owner?: string;
  }): Promise<SavedView.SavedView[]> {
    let out = [...this.savedViews.values()].filter(
      (v) => v.org === opts.org && v.project === opts.project && v.surface === opts.surface,
    );
    if (opts.owner) out = out.filter((v) => v.shared || v.owner === opts.owner);
    return out;
  }
  async saveSavedView(view: SavedView.SavedView): Promise<void> {
    this.savedViews.set(view.id, view);
  }
  async deleteSavedView(id: string): Promise<void> {
    this.savedViews.delete(id);
  }

  // ----- API tokens -----
  async listTokens(opts: { org: string; owner?: string }): Promise<ApiToken.ApiToken[]> {
    let out = [...this.tokens.values()].filter((t) => t.org === opts.org);
    if (opts.owner) out = out.filter((t) => t.owner === opts.owner);
    return out;
  }
  async createToken(token: ApiToken.ApiToken): Promise<void> {
    this.tokens.set(token.id, token);
  }
  async revokeToken(id: string, at: string): Promise<void> {
    const t = this.tokens.get(id);
    if (t) this.tokens.set(id, { ...t, revoked_at: at });
  }

  // ----- Tenancy -----
  async listOrgs(): Promise<Tenancy.Org[]> {
    return [...this.orgs.values()];
  }
  async loadOrg(slug: string): Promise<Tenancy.Org | null> {
    return this.orgs.get(slug) ?? null;
  }
  async saveOrg(org: Tenancy.Org): Promise<void> {
    this.orgs.set(org.slug, org);
  }
  async listProjects(org: string): Promise<Tenancy.ProjectRef[]> {
    return [...this.projects.values()].filter((p) => p.org === org);
  }
  async saveProject(project: Tenancy.ProjectRef): Promise<void> {
    this.projects.set(`${project.org}/${project.slug}`, project);
  }

  // ----- Aggregations -----
  async costSummary(opts: {
    org: string;
    project: string;
    from: string;
    to: string;
    budget_usd?: number;
  }): Promise<CostSummary.CostSummary> {
    const runs = [...this.runs.values()].filter(
      (r) => r.project === opts.project && r.started_at >= opts.from && r.started_at <= opts.to,
    );
    const byProfile = new Map<string, CostSummary.CostSummaryEntry>();
    const daily: Record<string, number> = {};
    let total = 0;
    for (const r of runs) {
      total += r.totals.llm_cost_usd;
      const day = r.started_at.slice(0, 10);
      daily[day] = (daily[day] ?? 0) + r.totals.llm_cost_usd;
      const e = byProfile.get(r.profile) ?? {
        profile: r.profile,
        llm_tokens_in: 0,
        llm_tokens_out: 0,
        llm_cost_usd: 0,
        runs: 0,
      };
      e.llm_tokens_in += r.totals.llm_tokens_in;
      e.llm_tokens_out += r.totals.llm_tokens_out;
      e.llm_cost_usd += r.totals.llm_cost_usd;
      e.runs += 1;
      byProfile.set(r.profile, e);
    }
    return {
      schema_version: '1' as const,
      org: opts.org,
      project: opts.project,
      from: opts.from,
      to: opts.to,
      total_usd: total,
      ...(opts.budget_usd !== undefined ? { budget_usd: opts.budget_usd } : {}),
      by_profile: [...byProfile.values()],
      daily,
    };
  }

  async close(): Promise<void> {
    this.runs.clear();
    this.events.clear();
    this.audit = [];
    this.findings.clear();
    this.packs.clear();
    this.profiles.clear();
    this.risks.clear();
    this.scenarios.clear();
    this.notifications = [];
    this.savedViews.clear();
    this.tokens.clear();
    this.orgs.clear();
    this.projects.clear();
  }
}
