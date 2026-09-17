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
import postgres from 'postgres';
import type { Sql } from 'postgres';
import type { StoreProvider, StoreUserDirectoryEntry } from './types.js';

type Kind =
  | 'run'
  | 'finding'
  | 'pack'
  | 'profile'
  | 'risk'
  | 'scenario'
  | 'agent'
  | 'notification'
  | 'saved_view'
  | 'token'
  | 'org'
  | 'project'
  | 'user'
  | 'sso';
type Row = { record_key: string; payload: unknown };

/** Durable PostgreSQL StoreProvider backed by schema-owned JSONB envelopes. */
export class PostgresStore implements StoreProvider {
  private readonly sql: Sql;
  private readonly ready: Promise<void>;

  constructor(dsn: string) {
    if (!dsn || !dsn.trim())
      throw new Error('[store/postgres] DSN is empty — refusing to construct.');
    this.sql = postgres(dsn, { max: 10, idle_timeout: 20, connect_timeout: 10 });
    this.ready = this.migrate();
  }
  private async q<T>(text: string, values: unknown[] = []): Promise<T[]> {
    const unsafe = this.sql.unsafe as unknown as (
      query: string,
      params: unknown[],
    ) => Promise<unknown>;
    return (await unsafe(text, values)) as T[];
  }
  private async migrate(): Promise<void> {
    await this.q(
      'CREATE TABLE IF NOT EXISTS aqa_store_schema (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    await this.q(
      'INSERT INTO aqa_store_schema (version) VALUES (1) ON CONFLICT (version) DO NOTHING',
    );
    await this.q(
      'CREATE TABLE IF NOT EXISTS aqa_store_records (kind text NOT NULL, record_key text NOT NULL, org text, project text, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (kind, record_key))',
    );
    await this.q(
      'CREATE INDEX IF NOT EXISTS aqa_store_records_scope_idx ON aqa_store_records (kind, org, project)',
    );
    await this.q(
      'CREATE TABLE IF NOT EXISTS aqa_store_events (event_hash text PRIMARY KEY, seq bigint NOT NULL, run_id text, org text, project text, ts timestamptz NOT NULL, payload jsonb NOT NULL)',
    );
    await this.q(
      'CREATE INDEX IF NOT EXISTS aqa_store_events_run_idx ON aqa_store_events (run_id, seq)',
    );
    await this.q(
      'CREATE INDEX IF NOT EXISTS aqa_store_events_scope_idx ON aqa_store_events (org, project, ts DESC)',
    );
  }
  private async wait(): Promise<void> {
    await this.ready;
  }
  private async one(kind: Kind, key: string): Promise<Row | null> {
    await this.wait();
    const rows = await this.q<Row>(
      'SELECT record_key, payload FROM aqa_store_records WHERE kind = $1 AND record_key = $2',
      [kind, key],
    );
    return rows[0] ?? null;
  }
  private async many(kind: Kind): Promise<Row[]> {
    await this.wait();
    return this.q<Row>(
      'SELECT record_key, payload FROM aqa_store_records WHERE kind = $1 ORDER BY updated_at DESC, record_key',
      [kind],
    );
  }
  private async put(
    kind: Kind,
    key: string,
    payload: unknown,
    org?: string,
    project?: string,
  ): Promise<void> {
    await this.wait();
    await this.q(
      'INSERT INTO aqa_store_records (kind, record_key, org, project, payload) VALUES ($1, $2, $3, $4, $5::jsonb) ON CONFLICT (kind, record_key) DO UPDATE SET org = EXCLUDED.org, project = EXCLUDED.project, payload = EXCLUDED.payload, updated_at = now()',
      [kind, key, org ?? null, project ?? null, JSON.stringify(payload)],
    );
  }
  private async remove(kind: Kind, key: string): Promise<void> {
    await this.wait();
    await this.q('DELETE FROM aqa_store_records WHERE kind = $1 AND record_key = $2', [kind, key]);
  }
  private decode<T>(value: unknown): T {
    if (typeof value !== 'string') return value as T;
    return JSON.parse(value) as T;
  }
  private payload<T>(row: Row | null): T | null {
    return row ? this.decode<T>(row.payload) : null;
  }
  private values<T>(rows: Row[]): T[] {
    return rows.map((row) => this.decode<T>(row.payload));
  }

  async saveRun(run: Run.Run): Promise<void> {
    await this.put('run', run.id, run, undefined, run.project);
  }
  async loadRun(id: string): Promise<Run.Run | null> {
    return this.payload(await this.one('run', id));
  }
  async listRuns(
    opts: { project?: string; profile?: string; state?: Run.Run['state']; limit?: number } = {},
  ): Promise<Run.Run[]> {
    let out = this.values<Run.Run>(await this.many('run'));
    if (opts.project) out = out.filter((run) => run.project === opts.project);
    if (opts.profile) out = out.filter((run) => run.profile === opts.profile);
    if (opts.state) out = out.filter((run) => run.state === opts.state);
    out.sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
    return opts.limit === undefined ? out : out.slice(0, opts.limit);
  }
  async appendEvent(event: Event.Event): Promise<void> {
    await this.wait();
    const runId = 'run_id' in event && typeof event.run_id === 'string' ? event.run_id : null;
    const payload = event.payload as Record<string, unknown>;
    await this.q(
      'INSERT INTO aqa_store_events (event_hash, seq, run_id, org, project, ts, payload) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) ON CONFLICT (event_hash) DO NOTHING',
      [
        event.hash,
        event.seq,
        runId,
        typeof payload.org === 'string' ? payload.org : null,
        typeof payload.project === 'string' ? payload.project : null,
        event.ts,
        JSON.stringify(event),
      ],
    );
  }
  async listEvents(runId: string): Promise<Event.Event[]> {
    await this.wait();
    const rows = await this.q<{ payload: Event.Event }>(
      'SELECT payload FROM aqa_store_events WHERE run_id = $1 ORDER BY seq',
      [runId],
    );
    return rows.map((row) => this.decode<Event.Event>(row.payload));
  }
  async listAuditEvents(opts: {
    org?: string;
    project?: string;
    kind?: Event.Event['kind'];
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<Event.Event[]> {
    await this.wait();
    const values: unknown[] = [
      opts.org ?? null,
      opts.project ?? null,
      opts.from ?? null,
      opts.to ?? null,
    ];
    let text =
      'SELECT payload FROM aqa_store_events WHERE ($1::text IS NULL OR org IS NULL OR org = $1) AND ($2::text IS NULL OR project IS NULL OR project = $2) AND ($3::timestamptz IS NULL OR ts >= $3) AND ($4::timestamptz IS NULL OR ts <= $4) ORDER BY ts DESC, seq DESC';
    if (opts.limit !== undefined) {
      values.push(opts.limit);
      text += ` LIMIT $${values.length}`;
    }
    const rows = await this.q<{ payload: Event.Event }>(text, values);
    return rows
      .map((row) => this.decode<Event.Event>(row.payload))
      .filter((event) => !opts.kind || event.kind === opts.kind);
  }

  async appendFinding(finding: Finding.Finding): Promise<void> {
    await this.put('finding', finding.id, finding);
  }
  async loadFinding(id: string): Promise<Finding.Finding | null> {
    return this.payload(await this.one('finding', id));
  }
  async updateFindingStatus(
    id: string,
    status: Finding.Finding['status'],
  ): Promise<Finding.Finding | null> {
    const current = await this.loadFinding(id);
    if (!current) return null;
    const updated = { ...current, status } as Finding.Finding;
    await this.put('finding', id, updated);
    return updated;
  }
  async listFindings(opts: {
    run_id?: string;
    severity?: Finding.Finding['severity'];
    status?: Finding.Finding['status'];
    limit?: number;
  }): Promise<Finding.Finding[]> {
    let out = this.values<Finding.Finding>(await this.many('finding'));
    if (opts.run_id) out = out.filter((finding) => finding.run_id === opts.run_id);
    if (opts.severity) out = out.filter((finding) => finding.severity === opts.severity);
    if (opts.status) out = out.filter((finding) => finding.status === opts.status);
    return opts.limit === undefined ? out : out.slice(0, opts.limit);
  }
  async listPacks(): Promise<PackManifest.PackManifest[]> {
    return this.values(await this.many('pack'));
  }
  async loadPack(slug: string): Promise<PackManifest.PackManifest | null> {
    return this.payload(await this.one('pack', slug));
  }
  async installPack(manifest: PackManifest.PackManifest): Promise<void> {
    await this.put('pack', manifest.name, manifest);
  }
  async uninstallPack(slug: string): Promise<void> {
    await this.remove('pack', slug);
  }
  async listProfiles(): Promise<Profile.Profile[]> {
    return this.values(await this.many('profile'));
  }
  async loadProfile(name: string): Promise<Profile.Profile | null> {
    return this.payload(await this.one('profile', name));
  }
  async saveProfile(profile: Profile.Profile): Promise<void> {
    await this.put('profile', profile.name, profile);
  }
  async createProfile(profile: Profile.Profile): Promise<{ created: boolean }> {
    await this.wait();
    const rows = await this.q(
      "INSERT INTO aqa_store_records (kind, record_key, payload) VALUES ('profile', $1, $2::jsonb) ON CONFLICT (kind, record_key) DO NOTHING RETURNING record_key",
      [profile.name, JSON.stringify(profile)],
    );
    return { created: rows.length === 1 };
  }
  async deleteProfile(name: string): Promise<void> {
    await this.remove('profile', name);
  }
  async listRisks(opts: { category?: RiskMap.Risk['category'] } = {}): Promise<RiskMap.Risk[]> {
    const out = this.values<RiskMap.Risk>(await this.many('risk'));
    return opts.category ? out.filter((risk) => risk.category === opts.category) : out;
  }
  async loadRisk(id: string): Promise<RiskMap.Risk | null> {
    return this.payload(await this.one('risk', id));
  }
  async saveRisk(risk: RiskMap.Risk): Promise<void> {
    await this.put('risk', risk.id, risk);
  }
  async deleteRisk(id: string): Promise<void> {
    await this.remove('risk', id);
  }
  async listScenarios(opts: { risk_id?: string } = {}): Promise<Scenario.Scenario[]> {
    const out = this.values<Scenario.Scenario>(await this.many('scenario'));
    const riskId = opts.risk_id;
    return riskId ? out.filter((scenario) => scenario.risk_refs.includes(riskId)) : out;
  }
  async loadScenario(id: string): Promise<Scenario.Scenario | null> {
    return this.payload(await this.one('scenario', id));
  }
  async saveScenario(scenario: Scenario.Scenario): Promise<void> {
    await this.put('scenario', scenario.id, scenario);
  }
  async createScenario(scenario: Scenario.Scenario): Promise<{ created: boolean }> {
    await this.wait();
    const rows = await this.q(
      "INSERT INTO aqa_store_records (kind, record_key, payload) VALUES ('scenario', $1, $2::jsonb) ON CONFLICT (kind, record_key) DO NOTHING RETURNING record_key",
      [scenario.id, JSON.stringify(scenario)],
    );
    return { created: rows.length === 1 };
  }
  async deleteScenario(id: string): Promise<void> {
    await this.remove('scenario', id);
  }
  async listAgents(): Promise<Agent.Agent[]> {
    return this.values(await this.many('agent'));
  }
  async loadAgent(id: string): Promise<Agent.Agent | null> {
    return this.payload(await this.one('agent', id));
  }
  async installAgent(id: string): Promise<Agent.Agent | null> {
    const agent = await this.loadAgent(id);
    if (!agent) return null;
    const updated = { ...agent, installed: true, last_updated: new Date().toISOString() };
    await this.put('agent', id, updated);
    return updated;
  }
  async uninstallAgent(id: string): Promise<Agent.Agent | null> {
    const agent = await this.loadAgent(id);
    if (!agent) return null;
    const updated = { ...agent, installed: false };
    await this.put('agent', id, updated);
    return updated;
  }
  async listUsers(): Promise<StoreUserDirectoryEntry[]> {
    return this.values<StoreUserDirectoryEntry>(await this.many('user'));
  }
  async upsertUser(user: StoreUserDirectoryEntry): Promise<void> {
    await this.put('user', user.id, user);
  }
  async loadSsoConfig(): Promise<SsoConfig.SsoConfig | null> {
    return this.payload(await this.one('sso', 'singleton'));
  }
  async saveSsoConfig(config: SsoConfig.SsoConfig): Promise<void> {
    await this.put('sso', 'singleton', config);
  }
  async listNotifications(opts: {
    org: string;
    project?: string;
    unread_for?: string;
    limit?: number;
  }): Promise<Notification.Notification[]> {
    let out = this.values<Notification.Notification>(await this.many('notification')).filter(
      (notification) => notification.org === opts.org,
    );
    if (opts.project) out = out.filter((notification) => notification.project === opts.project);
    if (opts.unread_for) {
      const userId = opts.unread_for;
      if (userId) out = out.filter((notification) => !notification.read_by.includes(userId));
    }
    return opts.limit === undefined ? out : out.slice(0, opts.limit);
  }
  async appendNotification(notification: Notification.Notification): Promise<void> {
    await this.put(
      'notification',
      notification.id,
      notification,
      notification.org,
      notification.project,
    );
  }
  async markNotificationRead(id: string, userId: string): Promise<void> {
    const notification = this.payload<Notification.Notification>(
      await this.one('notification', id),
    );
    if (notification && !notification.read_by.includes(userId))
      await this.put(
        'notification',
        id,
        { ...notification, read_by: [...notification.read_by, userId] },
        notification.org,
        notification.project,
      );
  }
  async listSavedViews(opts: {
    org: string;
    project: string;
    surface: SavedView.SavedViewSurface;
    owner?: string;
  }): Promise<SavedView.SavedView[]> {
    let out = this.values<SavedView.SavedView>(await this.many('saved_view')).filter(
      (view) =>
        view.org === opts.org && view.project === opts.project && view.surface === opts.surface,
    );
    if (opts.owner) out = out.filter((view) => view.shared || view.owner === opts.owner);
    return out;
  }
  async saveSavedView(view: SavedView.SavedView): Promise<void> {
    await this.put('saved_view', view.id, view, view.org, view.project);
  }
  async deleteSavedView(id: string): Promise<void> {
    await this.remove('saved_view', id);
  }
  async listTokens(opts: { org: string; owner?: string }): Promise<ApiToken.ApiToken[]> {
    let out = this.values<ApiToken.ApiToken>(await this.many('token')).filter(
      (token) => token.org === opts.org,
    );
    if (opts.owner) out = out.filter((token) => token.owner === opts.owner);
    return out;
  }
  async createToken(token: ApiToken.ApiToken): Promise<void> {
    await this.put('token', token.id, token, token.org);
  }
  async revokeToken(id: string, at: string): Promise<void> {
    const token = await this.payload<ApiToken.ApiToken>(await this.one('token', id));
    if (token) await this.put('token', id, { ...token, revoked_at: at }, token.org);
  }
  async listOrgs(): Promise<Tenancy.Org[]> {
    return this.values(await this.many('org'));
  }
  async loadOrg(slug: string): Promise<Tenancy.Org | null> {
    return this.payload(await this.one('org', slug));
  }
  async saveOrg(org: Tenancy.Org): Promise<void> {
    await this.put('org', org.slug, org);
  }
  async listProjects(org: string): Promise<Tenancy.ProjectRef[]> {
    return this.values<Tenancy.ProjectRef>(await this.many('project')).filter(
      (project) => project.org === org,
    );
  }
  async saveProject(project: Tenancy.ProjectRef): Promise<void> {
    await this.put('project', `${project.org}:${project.slug}`, project, project.org, project.slug);
  }
  async costSummary(opts: {
    org: string;
    project: string;
    from: string;
    to: string;
    budget_usd?: number;
  }): Promise<CostSummary.CostSummary> {
    const runs = (await this.listRuns({ project: opts.project })).filter(
      (run) => run.started_at >= opts.from && run.started_at <= opts.to,
    );
    const result: CostSummary.CostSummary = {
      schema_version: '1',
      org: opts.org,
      project: opts.project,
      from: opts.from,
      to: opts.to,
      total_usd: 0,
      ...(opts.budget_usd === undefined ? {} : { budget_usd: opts.budget_usd }),
      by_profile: [],
      daily: {},
    };
    for (const run of runs) {
      const cost = run.totals.llm_cost_usd;
      const day = run.started_at.slice(0, 10);
      result.total_usd += cost;
      result.daily[day] = (result.daily[day] ?? 0) + cost;
      const current = result.by_profile.find((entry) => entry.profile === run.profile);
      if (current) {
        current.llm_tokens_in += run.totals.llm_tokens_in;
        current.llm_tokens_out += run.totals.llm_tokens_out;
        current.llm_cost_usd += cost;
        current.runs += 1;
      } else {
        result.by_profile.push({
          profile: run.profile,
          llm_tokens_in: run.totals.llm_tokens_in,
          llm_tokens_out: run.totals.llm_tokens_out,
          llm_cost_usd: cost,
          runs: 1,
        });
      }
    }
    return result;
  }
  async close(): Promise<void> {
    await this.wait();
    await this.sql.end({ timeout: 5 });
  }
}
