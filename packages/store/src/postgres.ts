import {
  type MethodologyApproval,
  type MethodologyApprovalResult,
  type MethodologyArtifactEnvelope,
  type MethodologyArtifactLifecycle,
  type MethodologyProposal,
  type MethodologyRejection,
  type MethodologyRejectionResult,
  approveMethodologyProposal,
  archiveMethodologyArtifactLifecycle,
  assertMethodologyDecisionBinding,
  assertMethodologyProposal,
  createMethodologyArtifactLifecycle,
  isMethodologyArtifactExpired,
  parseMethodologyApproval,
  parseMethodologyArtifactEnvelope,
  parseMethodologyArtifactLifecycle,
  parseMethodologyProposal,
  parseMethodologyRejection,
  rejectMethodologyProposal,
  setMethodologyArtifactLegalHold,
} from '@aqa/methodology';
import { Finding } from '@aqa/schemas';
import type {
  Agent,
  ApiToken,
  CostSummary,
  Event,
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
import {
  InvalidFindingTransitionError,
  InvalidFindingVerificationError,
  findingStatusAudit,
  findingVerificationAudit,
} from './audit.js';
import {
  type LegacyMigrationResult,
  type MethodologyProposalRecord,
  type StoreProvider,
  type StoreScope,
  type StoreUserDirectoryEntry,
  scopedRecordKey,
} from './types.js';

type Kind =
  | 'run'
  | 'finding'
  | 'pack'
  | 'profile'
  | 'risk'
  | 'methodology_artifact'
  | 'methodology_artifact_lifecycle'
  | 'methodology_proposal'
  | 'scenario'
  | 'agent'
  | 'notification'
  | 'saved_view'
  | 'token'
  | 'org'
  | 'project'
  | 'user'
  | 'sso';
type Row = { record_key: string; payload: unknown; org?: string | null; project?: string | null };

/** Durable PostgreSQL StoreProvider backed by schema-owned JSONB envelopes. */
export class PostgresStore implements StoreProvider {
  isDurable(): boolean {
    return true;
  }
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
    await this.sql.begin(async (tx) => {
      const query = tx.unsafe as unknown as (text: string, values?: unknown[]) => Promise<unknown>;
      // DDL IF NOT EXISTS is not enough: two fresh application replicas can
      // still race on version bookkeeping. Keep migration/version updates in
      // one transaction and serialize them across processes.
      await query("SELECT pg_advisory_xact_lock(hashtext('aqa_store_schema'))");
      await query(
        'CREATE TABLE IF NOT EXISTS aqa_store_schema (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
      );
      await query(
        'INSERT INTO aqa_store_schema (version) VALUES (1) ON CONFLICT (version) DO NOTHING',
      );
      await query(
        'CREATE TABLE IF NOT EXISTS aqa_store_records (kind text NOT NULL, record_key text NOT NULL, org text, project text, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (kind, record_key))',
      );
      await query(
        'CREATE INDEX IF NOT EXISTS aqa_store_records_scope_idx ON aqa_store_records (kind, org, project)',
      );
      await query(
        'CREATE TABLE IF NOT EXISTS aqa_store_events (event_hash text PRIMARY KEY, seq bigint NOT NULL, run_id text, org text, project text, ts timestamptz NOT NULL, payload jsonb NOT NULL)',
      );
      await query(
        'CREATE INDEX IF NOT EXISTS aqa_store_events_run_idx ON aqa_store_events (run_id, seq)',
      );
      await query(
        'CREATE INDEX IF NOT EXISTS aqa_store_events_scope_idx ON aqa_store_events (org, project, ts DESC)',
      );
    });
  }
  private async wait(): Promise<void> {
    await this.ready;
  }
  private async one(kind: Kind, key: string, scope?: StoreScope): Promise<Row | null> {
    await this.wait();
    const namespaced = scopedRecordKey(key, scope);
    const rows = await this.q<Row>(
      'SELECT record_key, org, project, payload FROM aqa_store_records WHERE kind = $1 AND record_key = $2',
      [kind, namespaced],
    );
    return rows[0] ?? null;
  }
  private async many(kind: Kind, scope?: StoreScope): Promise<Row[]> {
    await this.wait();
    if (scope?.org && scope.project)
      return this.q<Row>(
        'SELECT record_key, org, project, payload FROM aqa_store_records WHERE kind = $1 AND org = $2 AND project = $3 ORDER BY updated_at DESC, record_key',
        [kind, scope.org, scope.project],
      );
    if (scope?.org)
      return this.q<Row>(
        'SELECT record_key, org, project, payload FROM aqa_store_records WHERE kind = $1 AND org = $2 ORDER BY updated_at DESC, record_key',
        [kind, scope.org],
      );
    if (scope?.project)
      return this.q<Row>(
        'SELECT record_key, org, project, payload FROM aqa_store_records WHERE kind = $1 AND project = $2 ORDER BY updated_at DESC, record_key',
        [kind, scope.project],
      );
    return this.q<Row>(
      'SELECT record_key, org, project, payload FROM aqa_store_records WHERE kind = $1 ORDER BY updated_at DESC, record_key',
      [kind],
    );
  }
  private async put(
    kind: Kind,
    key: string,
    payload: unknown,
    org?: string,
    project?: string,
    scope?: StoreScope,
  ): Promise<void> {
    await this.wait();
    const recordKey = scopedRecordKey(key, scope);
    await this.q(
      'INSERT INTO aqa_store_records (kind, record_key, org, project, payload) VALUES ($1, $2, $3, $4, $5::jsonb) ON CONFLICT (kind, record_key) DO UPDATE SET org = EXCLUDED.org, project = EXCLUDED.project, payload = EXCLUDED.payload, updated_at = now()',
      [
        kind,
        recordKey,
        scope?.org ?? org ?? null,
        scope?.project ?? project ?? null,
        JSON.stringify(payload),
      ],
    );
  }
  private async remove(kind: Kind, key: string, scope?: StoreScope): Promise<void> {
    await this.wait();
    await this.q('DELETE FROM aqa_store_records WHERE kind = $1 AND record_key = $2', [
      kind,
      scopedRecordKey(key, scope),
    ]);
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
    opts: {
      org?: string;
      project?: string;
      profile?: string;
      state?: Run.Run['state'];
      limit?: number;
    } = {},
  ): Promise<Run.Run[]> {
    let out = this.values<Run.Run>(await this.many('run'));
    if (opts.org) out = out.filter((run) => run.org === opts.org);
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
    actor: string,
    reason: string,
  ): Promise<Finding.Finding | null> {
    const transitioned = await this.transitionFindingStatus(id, status, actor, reason);
    return transitioned?.finding ?? null;
  }
  async transitionFindingStatus(
    id: string,
    status: Finding.Finding['status'],
    actor: string,
    reason: string,
  ): Promise<{ finding: Finding.Finding; event: Event.Event } | null> {
    await this.wait();
    return this.sql.begin(async (tx) => {
      const query = tx.unsafe as unknown as (text: string, values?: unknown[]) => Promise<unknown>;
      // Serialize the read/hash/append sequence across all writers. Row-locking the
      // last event is insufficient when two transactions observe an empty or stale tail.
      await query("SELECT pg_advisory_xact_lock(hashtext('aqa_store_audit'))");
      const findingRows = (await query(
        'SELECT payload FROM aqa_store_records WHERE kind = $1 AND record_key = $2 FOR UPDATE',
        ['finding', id],
      )) as Array<{ payload: unknown }>;
      const current = this.decode<Finding.Finding>(findingRows[0]?.payload);
      if (!current) return null;
      const transition = Finding.validateStatusTransition(current.status, status);
      if (!transition.ok) throw new InvalidFindingTransitionError(transition.reason);
      const auditRows = (await query(
        'SELECT payload FROM aqa_store_events ORDER BY seq DESC LIMIT 1 FOR UPDATE',
      )) as Array<{ payload: unknown }>;
      const previous = auditRows[0] ? this.decode<Event.Event>(auditRows[0].payload) : undefined;
      const event = findingStatusAudit(
        current,
        actor,
        current.status,
        status,
        reason,
        (previous?.seq ?? -1) + 1,
        previous,
      );
      const updated = Finding.Finding.parse({ ...current, status });
      await query(
        'UPDATE aqa_store_records SET payload = $3::jsonb, updated_at = now() WHERE kind = $2 AND record_key = $1',
        [id, 'finding', JSON.stringify(updated)],
      );
      await query(
        'INSERT INTO aqa_store_events (event_hash, seq, run_id, org, project, ts, payload) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)',
        [event.hash, event.seq, event.run_id, null, null, event.ts, JSON.stringify(event)],
      );
      return { finding: updated, event };
    });
  }
  async recordFindingVerification(
    id: string,
    verification: Finding.FindingVerification,
    actor: string,
  ): Promise<{ finding: Finding.Finding; event: Event.Event } | null> {
    await this.wait();
    return this.sql.begin(async (tx) => {
      const query = tx.unsafe as unknown as (text: string, values?: unknown[]) => Promise<unknown>;
      await query("SELECT pg_advisory_xact_lock(hashtext('aqa_store_audit'))");
      const findingRows = (await query(
        'SELECT payload FROM aqa_store_records WHERE kind = $1 AND record_key = $2 FOR UPDATE',
        ['finding', id],
      )) as Array<{ payload: unknown }>;
      const current = this.decode<Finding.Finding>(findingRows[0]?.payload);
      if (!current) return null;
      if (
        verification.outcome === 'reproduced' &&
        current.failure_fingerprint !== verification.expected_fingerprint
      )
        throw new InvalidFindingVerificationError(
          'verification fingerprint does not match finding',
        );
      const nextStatus =
        Finding.statusAfterVerification(current.status, verification) ?? current.status;
      if (nextStatus !== current.status) {
        const transition = Finding.validateStatusTransition(current.status, nextStatus);
        if (!transition.ok) throw new InvalidFindingTransitionError(transition.reason);
      }
      const auditRows = (await query(
        'SELECT payload FROM aqa_store_events ORDER BY seq DESC LIMIT 1 FOR UPDATE',
      )) as Array<{ payload: unknown }>;
      const previous = auditRows[0] ? this.decode<Event.Event>(auditRows[0].payload) : undefined;
      const event = findingVerificationAudit(
        current,
        actor,
        verification,
        current.status,
        nextStatus,
        (previous?.seq ?? -1) + 1,
        previous,
      );
      const updated = Finding.Finding.parse({
        ...current,
        status: nextStatus,
        last_verification: verification,
      });
      await query(
        'UPDATE aqa_store_records SET payload = $3::jsonb, updated_at = now() WHERE kind = $2 AND record_key = $1',
        [id, 'finding', JSON.stringify(updated)],
      );
      await query(
        'INSERT INTO aqa_store_events (event_hash, seq, run_id, org, project, ts, payload) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)',
        [event.hash, event.seq, event.run_id, null, null, event.ts, JSON.stringify(event)],
      );
      return { finding: updated, event };
    });
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
  async listPacks(opts: StoreScope = {}): Promise<PackManifest.PackManifest[]> {
    return this.values(await this.many('pack', opts));
  }
  async loadPack(slug: string, scope?: StoreScope): Promise<PackManifest.PackManifest | null> {
    return this.payload(await this.one('pack', slug, scope));
  }
  async installPack(manifest: PackManifest.PackManifest, scope?: StoreScope): Promise<void> {
    await this.put('pack', manifest.name, manifest, undefined, undefined, scope);
  }
  async uninstallPack(slug: string, scope?: StoreScope): Promise<void> {
    await this.remove('pack', slug, scope);
  }
  async listProfiles(opts: StoreScope = {}): Promise<Profile.Profile[]> {
    return this.values(await this.many('profile', opts));
  }
  async loadProfile(name: string, scope?: StoreScope): Promise<Profile.Profile | null> {
    return this.payload(await this.one('profile', name, scope));
  }
  async saveProfile(profile: Profile.Profile, scope?: StoreScope): Promise<void> {
    await this.put('profile', profile.name, profile, undefined, undefined, scope);
  }
  async createProfile(profile: Profile.Profile, scope?: StoreScope): Promise<{ created: boolean }> {
    await this.wait();
    const key = scopedRecordKey(profile.name, scope);
    const rows = await this.q(
      "INSERT INTO aqa_store_records (kind, record_key, org, project, payload) VALUES ('profile', $1, $2, $3, $4::jsonb) ON CONFLICT (kind, record_key) DO NOTHING RETURNING record_key",
      [key, scope?.org ?? null, scope?.project ?? null, JSON.stringify(profile)],
    );
    return { created: rows.length === 1 };
  }
  async deleteProfile(name: string, scope?: StoreScope): Promise<void> {
    await this.remove('profile', name, scope);
  }
  async listRisks(
    opts: { category?: RiskMap.Risk['category']; org?: string; project?: string } = {},
  ): Promise<RiskMap.Risk[]> {
    const out = this.values<RiskMap.Risk>(await this.many('risk', opts));
    return opts.category ? out.filter((risk) => risk.category === opts.category) : out;
  }
  async loadRisk(id: string, scope?: StoreScope): Promise<RiskMap.Risk | null> {
    return this.payload(await this.one('risk', id, scope));
  }
  async saveRisk(risk: RiskMap.Risk, scope?: StoreScope): Promise<void> {
    await this.put('risk', risk.id, risk, undefined, undefined, scope);
  }
  async deleteRisk(id: string, scope?: StoreScope): Promise<void> {
    await this.remove('risk', id, scope);
  }

  // ----- Methodology artifacts -----
  async listMethodologyArtifacts(
    opts: {
      org?: string;
      project?: string;
      artifact_kind?: MethodologyArtifactEnvelope['artifact_kind'];
    } = {},
  ): Promise<MethodologyArtifactEnvelope[]> {
    const out = this.values<unknown>(await this.many('methodology_artifact', opts)).map((value) =>
      parseMethodologyArtifactEnvelope(JSON.stringify(value)),
    );
    const filtered = opts.artifact_kind
      ? out.filter((artifact) => artifact.artifact_kind === opts.artifact_kind)
      : out;
    return filtered.sort((a, b) =>
      a.artifact_id === b.artifact_id
        ? b.revision - a.revision
        : a.artifact_id.localeCompare(b.artifact_id),
    );
  }
  async loadMethodologyArtifact(
    artifactId: string,
    revision: number,
    scope?: StoreScope,
  ): Promise<MethodologyArtifactEnvelope | null> {
    const value = this.payload<unknown>(
      await this.one('methodology_artifact', `${artifactId}@${revision}`, scope),
    );
    return value === null ? null : parseMethodologyArtifactEnvelope(JSON.stringify(value));
  }
  async saveMethodologyArtifact(
    artifact: MethodologyArtifactEnvelope,
    scope?: StoreScope,
  ): Promise<void> {
    const validated = parseMethodologyArtifactEnvelope(JSON.stringify(artifact));
    const key = `${validated.artifact_id}@${validated.revision}`;
    await this.wait();
    const rows = await this.q<{ record_key: string }>(
      'INSERT INTO aqa_store_records (kind, record_key, org, project, payload) VALUES ($1, $2, $3, $4, $5::jsonb) ON CONFLICT (kind, record_key) DO NOTHING RETURNING record_key',
      [
        'methodology_artifact',
        scopedRecordKey(key, scope),
        scope?.org ?? null,
        scope?.project ?? null,
        JSON.stringify(validated),
      ],
    );
    if (rows.length === 0) {
      const existing = await this.loadMethodologyArtifact(
        validated.artifact_id,
        validated.revision,
        scope,
      );
      if (!existing || existing.artifact_sha256 !== validated.artifact_sha256)
        throw new Error('methodology artifact revision conflict');
    }
  }

  async saveMethodologyArtifactWithLifecycle(
    artifact: MethodologyArtifactEnvelope,
    lifecycle: MethodologyArtifactLifecycle,
    scope?: StoreScope,
  ): Promise<void> {
    const validated = parseMethodologyArtifactEnvelope(JSON.stringify(artifact));
    const lifecycleValue = parseMethodologyArtifactLifecycle(lifecycle);
    if (
      validated.artifact_kind !== lifecycleValue.artifact_kind ||
      validated.artifact_id !== lifecycleValue.artifact_id ||
      validated.revision !== lifecycleValue.revision
    )
      throw new Error('methodology artifact lifecycle binding mismatch');
    await this.wait();
    await this.sql.begin(async (tx) => {
      const query = tx.unsafe as unknown as (text: string, values?: unknown[]) => Promise<unknown>;
      const recordKey = scopedRecordKey(`${validated.artifact_id}@${validated.revision}`, scope);
      await query(
        'INSERT INTO aqa_store_records (kind, record_key, org, project, payload) VALUES ($1, $2, $3, $4, $5::jsonb) ON CONFLICT (kind, record_key) DO NOTHING',
        [
          'methodology_artifact',
          recordKey,
          scope?.org ?? null,
          scope?.project ?? null,
          JSON.stringify(validated),
        ],
      );
      const existing = (await query(
        'SELECT payload::text AS payload FROM aqa_store_records WHERE kind = $1 AND record_key = $2 FOR UPDATE',
        ['methodology_artifact', recordKey],
      )) as Array<{ payload: unknown }>;
      const existingRow = existing[0];
      if (!existingRow) throw new Error('methodology artifact disappeared during atomic publish');
      const decodedPayload = this.decode(existingRow.payload);
      const existingArtifact = parseMethodologyArtifactEnvelope(
        typeof decodedPayload === 'string' ? decodedPayload : JSON.stringify(decodedPayload),
      );
      if (existingArtifact.artifact_sha256 !== validated.artifact_sha256)
        throw new Error('methodology artifact revision conflict');
      await query(
        'INSERT INTO aqa_store_records (kind, record_key, org, project, payload) VALUES ($1, $2, $3, $4, $5::jsonb) ON CONFLICT (kind, record_key) DO NOTHING',
        [
          'methodology_artifact_lifecycle',
          recordKey,
          scope?.org ?? null,
          scope?.project ?? null,
          JSON.stringify(lifecycleValue),
        ],
      );
    });
  }

  async loadMethodologyArtifactLifecycle(
    artifactId: string,
    revision: number,
    scope?: StoreScope,
  ): Promise<MethodologyArtifactLifecycle | null> {
    const value = this.payload<unknown>(
      await this.one('methodology_artifact_lifecycle', `${artifactId}@${revision}`, scope),
    );
    return value === null ? null : parseMethodologyArtifactLifecycle(value);
  }
  async saveMethodologyArtifactLifecycle(
    lifecycle: MethodologyArtifactLifecycle,
    scope?: StoreScope,
  ): Promise<void> {
    const validated = parseMethodologyArtifactLifecycle(lifecycle);
    const artifact = await this.loadMethodologyArtifact(
      validated.artifact_id,
      validated.revision,
      scope,
    );
    if (!artifact || artifact.artifact_kind !== validated.artifact_kind)
      throw new Error('methodology artifact does not exist');
    await this.put(
      'methodology_artifact_lifecycle',
      `${validated.artifact_id}@${validated.revision}`,
      validated,
      undefined,
      undefined,
      scope,
    );
  }
  async archiveMethodologyArtifact(
    artifactId: string,
    revision: number,
    input: { now: string; updated_by: string; reason: string },
    scope?: StoreScope,
  ): Promise<MethodologyArtifactLifecycle | null> {
    await this.wait();
    return this.sql.begin(async (tx) => {
      const query = tx.unsafe as unknown as (text: string, values?: unknown[]) => Promise<unknown>;
      const key = scopedRecordKey(`${artifactId}@${revision}`, scope);
      const rows = (await query(
        'SELECT payload FROM aqa_store_records WHERE kind = $1 AND record_key = $2 FOR UPDATE',
        ['methodology_artifact_lifecycle', key],
      )) as Array<{ payload: unknown }>;
      const row = rows[0];
      if (!row) return null;
      const artifacts = (await query(
        'SELECT 1 FROM aqa_store_records WHERE kind = $1 AND record_key = $2 LIMIT 1',
        ['methodology_artifact', key],
      )) as unknown[];
      if (artifacts.length === 0) return null;
      const updated = archiveMethodologyArtifactLifecycle(
        parseMethodologyArtifactLifecycle(this.decode(row.payload)),
        input,
      );
      await query(
        'UPDATE aqa_store_records SET payload = $1::jsonb, updated_at = now() WHERE kind = $2 AND record_key = $3',
        [JSON.stringify(updated), 'methodology_artifact_lifecycle', key],
      );
      return updated;
    });
  }
  async setMethodologyArtifactLegalHold(
    artifactId: string,
    revision: number,
    input: { now: string; updated_by: string; enabled: boolean; reason: string },
    scope?: StoreScope,
  ): Promise<MethodologyArtifactLifecycle | null> {
    await this.wait();
    return this.sql.begin(async (tx) => {
      const query = tx.unsafe as unknown as (text: string, values?: unknown[]) => Promise<unknown>;
      const key = scopedRecordKey(`${artifactId}@${revision}`, scope);
      const rows = (await query(
        'SELECT payload FROM aqa_store_records WHERE kind = $1 AND record_key = $2 FOR UPDATE',
        ['methodology_artifact_lifecycle', key],
      )) as Array<{ payload: unknown }>;
      const row = rows[0];
      if (!row) return null;
      const artifacts = (await query(
        'SELECT 1 FROM aqa_store_records WHERE kind = $1 AND record_key = $2 LIMIT 1',
        ['methodology_artifact', key],
      )) as unknown[];
      if (artifacts.length === 0) return null;
      const updated = setMethodologyArtifactLegalHold(
        parseMethodologyArtifactLifecycle(this.decode(row.payload)),
        input,
      );
      await query(
        'UPDATE aqa_store_records SET payload = $1::jsonb, updated_at = now() WHERE kind = $2 AND record_key = $3',
        [JSON.stringify(updated), 'methodology_artifact_lifecycle', key],
      );
      return updated;
    });
  }
  async purgeExpiredMethodologyArtifacts(now: string, scope?: StoreScope): Promise<number> {
    await this.wait();
    const purgedArtifactKeys: string[] = [];
    const purged = await this.sql.begin(async (tx) => {
      const query = tx.unsafe as unknown as (text: string, values?: unknown[]) => Promise<unknown>;
      const filters =
        scope?.org && scope.project
          ? { sql: ' AND org = $2 AND project = $3', values: [scope.org, scope.project] }
          : scope?.org
            ? { sql: ' AND org = $2', values: [scope.org] }
            : scope?.project
              ? { sql: ' AND project = $2', values: [scope.project] }
              : { sql: '', values: [] };
      const legacyRows = (await query(
        `SELECT record_key, org, project, payload FROM aqa_store_records WHERE kind = $1${filters.sql} AND NOT EXISTS (SELECT 1 FROM aqa_store_records l WHERE l.kind = 'methodology_artifact_lifecycle' AND l.record_key = aqa_store_records.record_key) FOR UPDATE`,
        ['methodology_artifact', ...filters.values],
      )) as Row[];
      for (const row of legacyRows) {
        const artifact = parseMethodologyArtifactEnvelope(JSON.stringify(this.decode(row.payload)));
        const lifecycle = createMethodologyArtifactLifecycle({
          artifact_kind: artifact.artifact_kind,
          artifact_id: artifact.artifact_id,
          revision: artifact.revision,
          now: artifact.created_at,
          updated_by: 'retention-migration',
          retention_days: 365,
          archive_after_days: 365,
        });
        await query(
          'INSERT INTO aqa_store_records (kind, record_key, org, project, payload) VALUES ($1, $2, $3, $4, $5::jsonb) ON CONFLICT (kind, record_key) DO NOTHING',
          [
            'methodology_artifact_lifecycle',
            row.record_key,
            row.org ?? null,
            row.project ?? null,
            JSON.stringify(lifecycle),
          ],
        );
      }
      const rows = (await query(
        `SELECT record_key, org, project, payload FROM aqa_store_records WHERE kind = $1${filters.sql} ORDER BY record_key FOR UPDATE`,
        ['methodology_artifact_lifecycle', ...filters.values],
      )) as Row[];
      let purged = 0;
      for (const row of rows) {
        let current = parseMethodologyArtifactLifecycle(this.decode(row.payload));
        const lifecycleKey = row.record_key;
        const tenantOrg = scope?.org ?? row.org ?? null;
        const tenantProject = scope?.project ?? row.project ?? null;
        const artifactKey = scopedRecordKey(`${current.artifact_id}@${current.revision}`, {
          ...(tenantOrg ? { org: tenantOrg } : {}),
          ...(tenantProject ? { project: tenantProject } : {}),
        });
        if (
          !current.legal_hold &&
          current.state === 'active' &&
          Date.parse(now) >= Date.parse(current.archive_after)
        ) {
          current = {
            ...current,
            state: 'archived',
            updated_at: now,
            updated_by: 'retention-reconciler',
            reason: 'Retention archive threshold reached',
          };
          await query(
            'UPDATE aqa_store_records SET payload = $1::jsonb, updated_at = now() WHERE kind = $2 AND record_key = $3',
            [JSON.stringify(current), 'methodology_artifact_lifecycle', lifecycleKey],
          );
        }
        if (!isMethodologyArtifactExpired(current, now)) continue;
        await query('DELETE FROM aqa_store_records WHERE kind = $1 AND record_key = $2', [
          'methodology_artifact_lifecycle',
          lifecycleKey,
        ]);
        const deletedArtifacts = (await query(
          `DELETE FROM aqa_store_records WHERE kind = 'methodology_artifact' AND (record_key = $1 OR record_key = $2 OR (org IS NOT DISTINCT FROM $3 AND project IS NOT DISTINCT FROM $4 AND payload->>'artifact_id' = $5 AND (payload->>'revision')::integer = $6)) RETURNING record_key`,
          [
            artifactKey,
            lifecycleKey,
            tenantOrg,
            tenantProject,
            current.artifact_id,
            current.revision,
          ],
        )) as Array<{ record_key: string }>;
        if (deletedArtifacts.length === 0)
          throw new Error(
            `methodology retention purge could not delete artifact ${current.artifact_id}@${current.revision}`,
          );
        const remainingArtifacts = (await query(
          `SELECT record_key, org, project FROM aqa_store_records WHERE kind = 'methodology_artifact' AND payload->>'artifact_id' = $1 AND (payload->>'revision')::integer = $2`,
          [current.artifact_id, current.revision],
        )) as Array<{ record_key: string; org: string | null; project: string | null }>;
        if (remainingArtifacts.length > 0)
          throw new Error(
            `methodology retention purge left artifact rows: ${JSON.stringify(remainingArtifacts)}`,
          );
        purgedArtifactKeys.push(artifactKey);
        await query(
          `UPDATE aqa_store_records SET payload = payload - 'artifact', updated_at = now() WHERE kind = 'methodology_proposal' AND org IS NOT DISTINCT FROM $1 AND project IS NOT DISTINCT FROM $2 AND payload->'proposal'->>'status' IN ('approved', 'rejected') AND payload->'artifact'->>'artifact_id' = $3 AND (payload->'artifact'->>'revision')::integer = $4`,
          [tenantOrg, tenantProject, current.artifact_id, current.revision],
        );
        purged += 1;
      }
      return purged;
    });
    for (const artifactKey of purgedArtifactKeys)
      await this.q('DELETE FROM aqa_store_records WHERE kind = $1 AND record_key = $2', [
        'methodology_artifact',
        artifactKey,
      ]);
    return purged;
  }

  // ----- Methodology proposals -----
  async listMethodologyProposals(
    opts: { org?: string; project?: string; status?: MethodologyProposal['status'] } = {},
  ): Promise<MethodologyProposalRecord[]> {
    const records = this.values<unknown>(await this.many('methodology_proposal', opts)).map(
      parseMethodologyProposalRecord,
    );
    return records
      .filter((record) => !opts.status || record.proposal.status === opts.status)
      .sort((a, b) => (a.proposal.proposed_at < b.proposal.proposed_at ? 1 : -1));
  }
  async loadMethodologyProposal(
    proposalId: string,
    scope?: StoreScope,
  ): Promise<MethodologyProposalRecord | null> {
    const value = this.payload<unknown>(await this.one('methodology_proposal', proposalId, scope));
    return value === null ? null : parseMethodologyProposalRecord(value);
  }
  async saveMethodologyProposal(
    proposal: MethodologyProposal,
    scope?: StoreScope,
    artifact?: MethodologyArtifactEnvelope,
  ): Promise<void> {
    const normalized = parseMethodologyProposal(proposal);
    assertMethodologyProposal(normalized);
    if (normalized.status !== 'pending') throw new Error('methodology proposal must be pending');
    const normalizedArtifact = artifact
      ? parseMethodologyArtifactEnvelope(JSON.stringify(artifact))
      : undefined;
    if (
      normalizedArtifact &&
      (normalizedArtifact.artifact_kind !== normalized.artifact_kind ||
        normalizedArtifact.artifact_id !== normalized.artifact_id ||
        normalizedArtifact.revision !== normalized.revision ||
        normalizedArtifact.artifact_sha256 !== normalized.artifact_sha256)
    )
      throw new Error('methodology proposal does not bind to artifact');
    await this.wait();
    const record: MethodologyProposalRecord = {
      proposal: normalized,
      ...(normalizedArtifact ? { artifact: normalizedArtifact } : {}),
    };
    const rows = await this.q<{ record_key: string }>(
      'INSERT INTO aqa_store_records (kind, record_key, org, project, payload) VALUES ($1, $2, $3, $4, $5::jsonb) ON CONFLICT (kind, record_key) DO NOTHING RETURNING record_key',
      [
        'methodology_proposal',
        scopedRecordKey(normalized.proposal_id, scope),
        scope?.org ?? null,
        scope?.project ?? null,
        JSON.stringify(record),
      ],
    );
    if (rows.length === 0) {
      const existing = await this.loadMethodologyProposal(proposal.proposal_id, scope);
      if (
        !existing ||
        JSON.stringify(existing.proposal) !== JSON.stringify(normalized) ||
        JSON.stringify(existing.artifact) !== JSON.stringify(normalizedArtifact)
      )
        throw new Error('methodology proposal conflict');
    }
  }
  async approveMethodologyProposal(
    proposalId: string,
    approval: MethodologyApproval,
    scope?: StoreScope,
  ): Promise<MethodologyApprovalResult | null> {
    const current = await this.loadMethodologyProposal(proposalId, scope);
    if (!current) return null;
    const result = approveMethodologyProposal(current.proposal, parseMethodologyApproval(approval));
    await this.wait();
    const rows = await this.q<{ payload: unknown }>(
      'UPDATE aqa_store_records SET payload = $4::jsonb, updated_at = now() WHERE kind = $1 AND record_key = $2 AND payload = $3::jsonb RETURNING payload',
      [
        'methodology_proposal',
        scopedRecordKey(proposalId, scope),
        JSON.stringify(current),
        JSON.stringify({
          proposal: result.proposal,
          ...(current.artifact ? { artifact: current.artifact } : {}),
          approval: result.approval,
        }),
      ],
    );
    if (rows.length === 0) throw new Error('methodology proposal approval conflict');
    return result;
  }
  async rejectMethodologyProposal(
    proposalId: string,
    rejection: MethodologyRejection,
    scope?: StoreScope,
  ): Promise<MethodologyRejectionResult | null> {
    const current = await this.loadMethodologyProposal(proposalId, scope);
    if (!current) return null;
    const result = rejectMethodologyProposal(
      current.proposal,
      parseMethodologyRejection(rejection),
    );
    await this.wait();
    const rows = await this.q<{ payload: unknown }>(
      'UPDATE aqa_store_records SET payload = $4::jsonb, updated_at = now() WHERE kind = $1 AND record_key = $2 AND payload = $3::jsonb RETURNING payload',
      [
        'methodology_proposal',
        scopedRecordKey(proposalId, scope),
        JSON.stringify(current),
        JSON.stringify({
          proposal: result.proposal,
          ...(current.artifact ? { artifact: current.artifact } : {}),
          rejection: result.rejection,
        }),
      ],
    );
    if (rows.length === 0) throw new Error('methodology proposal rejection conflict');
    return result;
  }
  async listScenarios(
    opts: { risk_id?: string; org?: string; project?: string } = {},
  ): Promise<Scenario.Scenario[]> {
    const out = this.values<Scenario.Scenario>(await this.many('scenario', opts));
    const riskId = opts.risk_id;
    return riskId ? out.filter((scenario) => scenario.risk_refs.includes(riskId)) : out;
  }
  async loadScenario(id: string, scope?: StoreScope): Promise<Scenario.Scenario | null> {
    return this.payload(await this.one('scenario', id, scope));
  }
  async saveScenario(scenario: Scenario.Scenario, scope?: StoreScope): Promise<void> {
    await this.put('scenario', scenario.id, scenario, undefined, undefined, scope);
  }
  async createScenario(
    scenario: Scenario.Scenario,
    scope?: StoreScope,
  ): Promise<{ created: boolean }> {
    await this.wait();
    const key = scopedRecordKey(scenario.id, scope);
    const rows = await this.q(
      "INSERT INTO aqa_store_records (kind, record_key, org, project, payload) VALUES ('scenario', $1, $2, $3, $4::jsonb) ON CONFLICT (kind, record_key) DO NOTHING RETURNING record_key",
      [key, scope?.org ?? null, scope?.project ?? null, JSON.stringify(scenario)],
    );
    return { created: rows.length === 1 };
  }
  async deleteScenario(id: string, scope?: StoreScope): Promise<void> {
    await this.remove('scenario', id, scope);
  }

  async migrateLegacyConfiguration(scope: StoreScope): Promise<LegacyMigrationResult> {
    if (!scope.org && !scope.project)
      throw new Error('legacy migration requires an org or project destination');
    await this.wait();
    const kinds = ['pack', 'profile', 'risk', 'scenario'] as const;
    return this.sql.begin(async (tx) => {
      const query = tx.unsafe as unknown as (text: string, values?: unknown[]) => Promise<unknown>;
      await query("SELECT pg_advisory_xact_lock(hashtext('aqa_store_legacy_migration'))");
      const legacy = (await query(
        'SELECT kind, record_key, payload FROM aqa_store_records WHERE kind = ANY($1) AND record_key NOT LIKE $2',
        [kinds, '@scope/%'],
      )) as Array<{ kind: string; record_key: string; payload: unknown }>;
      const conflicts: string[] = [];
      for (const row of legacy) {
        const target = scopedRecordKey(row.record_key, scope);
        const found = (await query(
          'SELECT 1 FROM aqa_store_records WHERE kind = $1 AND record_key = $2 LIMIT 1',
          [row.kind, target],
        )) as unknown[];
        if (found.length > 0) conflicts.push(`${row.kind}:${row.record_key}`);
      }
      if (conflicts.length > 0) return { migrated: 0, skipped: legacy.length, conflicts };
      for (const row of legacy) {
        await query(
          'UPDATE aqa_store_records SET record_key = $1, org = $2, project = $3, updated_at = now() WHERE kind = $4 AND record_key = $5',
          [
            scopedRecordKey(row.record_key, scope),
            scope.org ?? null,
            scope.project ?? null,
            row.kind,
            row.record_key,
          ],
        );
      }
      return { migrated: legacy.length, skipped: 0, conflicts: [] };
    });
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
  async listUsers(scope?: StoreScope): Promise<StoreUserDirectoryEntry[]> {
    return this.values<StoreUserDirectoryEntry>(await this.many('user', scope));
  }
  async upsertUser(user: StoreUserDirectoryEntry, scope?: StoreScope): Promise<void> {
    await this.put('user', user.id, user, undefined, undefined, scope);
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

function parseMethodologyProposalRecord(input: unknown): MethodologyProposalRecord {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('methodology proposal record must be an object');
  const record = input as {
    proposal?: unknown;
    artifact?: unknown;
    approval?: unknown;
    rejection?: unknown;
  };
  if (
    Object.keys(record).some(
      (key) =>
        key !== 'proposal' && key !== 'artifact' && key !== 'approval' && key !== 'rejection',
    )
  )
    throw new Error('methodology proposal record contains an unknown field');
  const proposal = parseMethodologyProposal(record.proposal);
  const artifact =
    record.artifact === undefined
      ? undefined
      : parseMethodologyArtifactEnvelope(JSON.stringify(record.artifact));
  const approval =
    record.approval === undefined ? undefined : parseMethodologyApproval(record.approval);
  const rejection =
    record.rejection === undefined ? undefined : parseMethodologyRejection(record.rejection);
  if (
    artifact &&
    (artifact.artifact_kind !== proposal.artifact_kind ||
      artifact.artifact_id !== proposal.artifact_id ||
      artifact.revision !== proposal.revision ||
      artifact.artifact_sha256 !== proposal.artifact_sha256)
  )
    throw new Error('methodology proposal record artifact binding mismatch');
  if (approval && rejection) throw new Error('methodology proposal record has two decisions');
  assertMethodologyDecisionBinding(proposal, approval, rejection);
  return {
    proposal,
    ...(artifact ? { artifact } : {}),
    ...(approval ? { approval } : {}),
    ...(rejection ? { rejection } : {}),
  };
}
