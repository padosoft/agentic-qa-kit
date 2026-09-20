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
import {
  InvalidFindingTransitionError,
  InvalidFindingVerificationError,
  findingStatusAudit,
  findingVerificationAudit,
} from './audit.js';
import {
  type MethodologyProposalRecord,
  type StoreProvider,
  type StoreScope,
  type StoreUserDirectoryEntry,
  isScopedRecordKey,
  scopedRecordKey,
} from './types.js';

/**
 * In-memory StoreProvider — the v0.3 default. Useful for tests, smoke runs,
 * and developer-local profiles. Drops everything on `close()`. The Postgres
 * adapter has identical semantics and tests share fixtures.
 */
export class MemoryStore implements StoreProvider {
  isDurable(): boolean {
    return false;
  }
  private runs = new Map<string, Run.Run>();
  private events = new Map<string, Event.Event[]>();
  private audit: Event.Event[] = [];
  private findings = new Map<string, Finding.Finding>();
  private packs = new Map<string, PackManifest.PackManifest>();
  private profiles = new Map<string, Profile.Profile>();
  private risks = new Map<string, RiskMap.Risk>();
  private methodologyArtifacts = new Map<string, MethodologyArtifactEnvelope>();
  private methodologyArtifactLifecycles = new Map<string, MethodologyArtifactLifecycle>();
  private methodologyLifecycleLocks = new Map<string, Promise<void>>();
  private methodologyProposals = new Map<string, MethodologyProposalRecord>();
  private scenarios = new Map<string, Scenario.Scenario>();
  private agents = new Map<string, Agent.Agent>();
  private notifications: Notification.Notification[] = [];
  private savedViews = new Map<string, SavedView.SavedView>();
  private tokens = new Map<string, ApiToken.ApiToken>();
  private orgs = new Map<string, Tenancy.Org>();
  private projects = new Map<string, Tenancy.ProjectRef>();
  private ssoConfig: SsoConfig.SsoConfig | null = null;
  // v1.7 slice 4g — directory snapshot of users known to the admin.
  // Real deployments seed this from the IdP (OIDC userinfo or SCIM).
  private users = new Map<string, StoreUserDirectoryEntry>();

  private visible<T>(map: Map<string, T>, scope?: StoreScope): T[] {
    if (!scope?.org && !scope?.project) return [...map.values()];
    if (!scope.org && scope.project) {
      const encodedProject = encodeURIComponent(scope.project);
      return [...map.entries()]
        .filter(([key]) => {
          const parts = key.split('/');
          return parts[0] === '@scope' && parts[2] === encodedProject;
        })
        .map(([, value]) => value);
    }
    const prefix =
      scope.org && scope.project
        ? scopedRecordKey('', scope)
        : scope.org
          ? `@scope/${encodeURIComponent(scope.org)}/`
          : '';
    return [...map.entries()]
      .filter(([key]) => isScopedRecordKey(key) && key.startsWith(prefix))
      .map(([, value]) => value);
  }

  private key(key: string, scope?: StoreScope): string {
    return scopedRecordKey(key, scope);
  }

  private async withMethodologyLifecycleLock<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.methodologyLifecycleLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.methodologyLifecycleLocks.set(key, current);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.methodologyLifecycleLocks.get(key) === current)
        this.methodologyLifecycleLocks.delete(key);
    }
  }

  // ----- Runs -----
  async saveRun(run: Run.Run): Promise<void> {
    this.runs.set(run.id, run);
  }
  async loadRun(id: string): Promise<Run.Run | null> {
    return this.runs.get(id) ?? null;
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
    let out = [...this.runs.values()];
    if (opts.org) out = out.filter((r) => r.org === opts.org);
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
    const current = this.findings.get(id);
    if (!current) return null;
    const transition = Finding.validateStatusTransition(current.status, status);
    if (!transition.ok) throw new InvalidFindingTransitionError(transition.reason);
    const updated = Finding.Finding.parse({ ...current, status });
    const previous = this.audit[this.audit.length - 1];
    const event = findingStatusAudit(
      current,
      actor,
      current.status,
      status,
      reason,
      this.audit.length,
      previous,
    );
    this.findings.set(id, updated);
    this.audit.push(event);
    const bucket = this.events.get(current.run_id) ?? [];
    bucket.push(event);
    this.events.set(current.run_id, bucket);
    return { finding: updated, event };
  }
  async recordFindingVerification(
    id: string,
    verification: Finding.FindingVerification,
    actor: string,
  ): Promise<{ finding: Finding.Finding; event: Event.Event } | null> {
    const current = this.findings.get(id);
    if (!current) return null;
    if (
      verification.outcome === 'reproduced' &&
      current.failure_fingerprint !== verification.expected_fingerprint
    )
      throw new InvalidFindingVerificationError('verification fingerprint does not match finding');
    const nextStatus =
      Finding.statusAfterVerification(current.status, verification) ?? current.status;
    if (nextStatus !== current.status) {
      const transition = Finding.validateStatusTransition(current.status, nextStatus);
      if (!transition.ok) throw new InvalidFindingTransitionError(transition.reason);
    }
    const updated = Finding.Finding.parse({
      ...current,
      status: nextStatus,
      last_verification: verification,
    });
    const previous = this.audit[this.audit.length - 1];
    const event = findingVerificationAudit(
      current,
      actor,
      verification,
      current.status,
      nextStatus,
      this.audit.length,
      previous,
    );
    this.findings.set(id, updated);
    this.audit.push(event);
    const bucket = this.events.get(current.run_id) ?? [];
    bucket.push(event);
    this.events.set(current.run_id, bucket);
    return { finding: updated, event };
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
  async listPacks(scope?: StoreScope): Promise<PackManifest.PackManifest[]> {
    return this.visible(this.packs, scope);
  }
  async loadPack(slug: string, scope?: StoreScope): Promise<PackManifest.PackManifest | null> {
    return this.packs.get(this.key(slug, scope)) ?? null;
  }
  async installPack(manifest: PackManifest.PackManifest, scope?: StoreScope): Promise<void> {
    this.packs.set(this.key(manifest.name, scope), manifest);
  }
  async uninstallPack(slug: string, scope?: StoreScope): Promise<void> {
    this.packs.delete(this.key(slug, scope));
  }

  // ----- Profiles -----
  async listProfiles(scope?: StoreScope): Promise<Profile.Profile[]> {
    return this.visible(this.profiles, scope);
  }
  async loadProfile(name: string, scope?: StoreScope): Promise<Profile.Profile | null> {
    return this.profiles.get(this.key(name, scope)) ?? null;
  }
  async saveProfile(profile: Profile.Profile, scope?: StoreScope): Promise<void> {
    this.profiles.set(this.key(profile.name, scope), profile);
  }
  async createProfile(profile: Profile.Profile, scope?: StoreScope): Promise<{ created: boolean }> {
    // `has` + `set` runs synchronously between awaits, so two concurrent
    // callers can't both observe "missing" and overwrite each other.
    const key = this.key(profile.name, scope);
    if (this.profiles.has(key)) return { created: false };
    this.profiles.set(key, profile);
    return { created: true };
  }
  async deleteProfile(name: string, scope?: StoreScope): Promise<void> {
    this.profiles.delete(this.key(name, scope));
  }

  // ----- Risks -----
  async listRisks(
    opts: {
      org?: string;
      project?: string;
      category?: RiskMap.Risk['category'];
    } = {},
  ): Promise<RiskMap.Risk[]> {
    let out = this.visible(this.risks, opts);
    if (opts.category) out = out.filter((r) => r.category === opts.category);
    return out;
  }
  async loadRisk(id: string, scope?: StoreScope): Promise<RiskMap.Risk | null> {
    return this.risks.get(this.key(id, scope)) ?? null;
  }
  async saveRisk(risk: RiskMap.Risk, scope?: StoreScope): Promise<void> {
    this.risks.set(this.key(risk.id, scope), risk);
  }
  async deleteRisk(id: string, scope?: StoreScope): Promise<void> {
    this.risks.delete(this.key(id, scope));
  }

  // ----- Methodology artifacts -----
  async listMethodologyArtifacts(
    opts: {
      org?: string;
      project?: string;
      artifact_kind?: MethodologyArtifactEnvelope['artifact_kind'];
    } = {},
  ): Promise<MethodologyArtifactEnvelope[]> {
    let out = this.visible(this.methodologyArtifacts, opts).map((artifact) =>
      parseMethodologyArtifactEnvelope(JSON.stringify(artifact)),
    );
    if (opts.artifact_kind)
      out = out.filter((artifact) => artifact.artifact_kind === opts.artifact_kind);
    return out.sort((a, b) =>
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
    const artifact = this.methodologyArtifacts.get(this.key(`${artifactId}@${revision}`, scope));
    return artifact ? parseMethodologyArtifactEnvelope(JSON.stringify(artifact)) : null;
  }
  async saveMethodologyArtifact(
    artifact: MethodologyArtifactEnvelope,
    scope?: StoreScope,
  ): Promise<void> {
    const validated = parseMethodologyArtifactEnvelope(JSON.stringify(artifact));
    const key = this.key(`${validated.artifact_id}@${validated.revision}`, scope);
    const existing = this.methodologyArtifacts.get(key);
    if (
      existing &&
      (existing.artifact_sha256 !== validated.artifact_sha256 ||
        existing.artifact_kind !== validated.artifact_kind)
    )
      throw new Error('methodology artifact revision conflict');
    this.methodologyArtifacts.set(key, JSON.parse(JSON.stringify(validated)));
  }
  async saveMethodologyArtifactWithLifecycle(
    artifact: MethodologyArtifactEnvelope,
    lifecycle: MethodologyArtifactLifecycle,
    scope?: StoreScope,
  ): Promise<void> {
    const validatedArtifact = parseMethodologyArtifactEnvelope(JSON.stringify(artifact));
    const validatedLifecycle = parseMethodologyArtifactLifecycle(lifecycle);
    if (
      validatedArtifact.artifact_kind !== validatedLifecycle.artifact_kind ||
      validatedArtifact.artifact_id !== validatedLifecycle.artifact_id ||
      validatedArtifact.revision !== validatedLifecycle.revision
    )
      throw new Error('methodology artifact lifecycle binding mismatch');
    const key = this.key(`${validatedArtifact.artifact_id}@${validatedArtifact.revision}`, scope);
    await this.withMethodologyLifecycleLock(key, async () => {
      const existing = this.methodologyArtifacts.get(key);
      if (
        existing &&
        (existing.artifact_sha256 !== validatedArtifact.artifact_sha256 ||
          existing.artifact_kind !== validatedArtifact.artifact_kind)
      )
        throw new Error('methodology artifact revision conflict');
      if (this.methodologyArtifactLifecycles.has(key)) return;
      this.methodologyArtifacts.set(key, JSON.parse(JSON.stringify(validatedArtifact)));
      this.methodologyArtifactLifecycles.set(key, JSON.parse(JSON.stringify(validatedLifecycle)));
    });
  }

  async loadMethodologyArtifactLifecycle(
    artifactId: string,
    revision: number,
    scope?: StoreScope,
  ): Promise<MethodologyArtifactLifecycle | null> {
    const lifecycle = this.methodologyArtifactLifecycles.get(
      this.key(`${artifactId}@${revision}`, scope),
    );
    return lifecycle
      ? parseMethodologyArtifactLifecycle(JSON.parse(JSON.stringify(lifecycle)))
      : null;
  }
  async saveMethodologyArtifactLifecycle(
    lifecycle: MethodologyArtifactLifecycle,
    scope?: StoreScope,
  ): Promise<void> {
    const validated = parseMethodologyArtifactLifecycle(lifecycle);
    const key = this.key(`${validated.artifact_id}@${validated.revision}`, scope);
    await this.withMethodologyLifecycleLock(key, async () => {
      const artifact = this.methodologyArtifacts.get(key);
      if (!artifact) throw new Error('methodology artifact does not exist');
      if (artifact.artifact_kind !== validated.artifact_kind)
        throw new Error('methodology lifecycle does not bind to artifact');
      this.methodologyArtifactLifecycles.set(key, JSON.parse(JSON.stringify(validated)));
    });
  }
  async archiveMethodologyArtifact(
    artifactId: string,
    revision: number,
    input: { now: string; updated_by: string; reason: string },
    scope?: StoreScope,
  ): Promise<MethodologyArtifactLifecycle | null> {
    const key = this.key(`${artifactId}@${revision}`, scope);
    return this.withMethodologyLifecycleLock(key, async () => {
      const current = await this.loadMethodologyArtifactLifecycle(artifactId, revision, scope);
      if (!current) return null;
      const updated = archiveMethodologyArtifactLifecycle(current, input);
      this.methodologyArtifactLifecycles.set(key, JSON.parse(JSON.stringify(updated)));
      return updated;
    });
  }
  async setMethodologyArtifactLegalHold(
    artifactId: string,
    revision: number,
    input: { now: string; updated_by: string; enabled: boolean; reason: string },
    scope?: StoreScope,
  ): Promise<MethodologyArtifactLifecycle | null> {
    const key = this.key(`${artifactId}@${revision}`, scope);
    return this.withMethodologyLifecycleLock(key, async () => {
      const current = await this.loadMethodologyArtifactLifecycle(artifactId, revision, scope);
      if (!current) return null;
      const updated = setMethodologyArtifactLegalHold(current, input);
      this.methodologyArtifactLifecycles.set(key, JSON.parse(JSON.stringify(updated)));
      return updated;
    });
  }
  async purgeExpiredMethodologyArtifacts(now: string, scope?: StoreScope): Promise<number> {
    for (const [key, artifact] of this.methodologyArtifacts.entries()) {
      if (
        !this.visible(new Map([[key, artifact]]), scope).length ||
        this.methodologyArtifactLifecycles.has(key)
      )
        continue;
      const lifecycle = createMethodologyArtifactLifecycle({
        artifact_kind: artifact.artifact_kind,
        artifact_id: artifact.artifact_id,
        revision: artifact.revision,
        now: artifact.created_at,
        updated_by: 'retention-migration',
        retention_days: 365,
        archive_after_days: 365,
      });
      await this.withMethodologyLifecycleLock(key, async () => {
        if (this.methodologyArtifacts.has(key) && !this.methodologyArtifactLifecycles.has(key))
          this.methodologyArtifactLifecycles.set(key, lifecycle);
      });
    }
    let purged = 0;
    for (const [key, lifecycle] of this.methodologyArtifactLifecycles.entries()) {
      if (!this.visible(new Map([[key, lifecycle]]), scope).length) continue;
      await this.withMethodologyLifecycleLock(key, async () => {
        const currentArtifact = this.methodologyArtifacts.get(key);
        const currentLifecycle = this.methodologyArtifactLifecycles.get(key);
        if (!currentArtifact || !currentLifecycle) return;
        let current = currentLifecycle;
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
          this.methodologyArtifactLifecycles.set(key, current);
        }
        if (!isMethodologyArtifactExpired(current, now)) return;
        this.methodologyArtifactLifecycles.delete(key);
        this.methodologyArtifacts.delete(key);
        const namespacePrefix = isScopedRecordKey(key)
          ? key.slice(0, key.lastIndexOf('/') + 1)
          : '';
        for (const [proposalKey, record] of this.methodologyProposals.entries()) {
          if (
            namespacePrefix
              ? !proposalKey.startsWith(namespacePrefix)
              : isScopedRecordKey(proposalKey)
          )
            continue;
          if (
            (record.proposal.status === 'approved' || record.proposal.status === 'rejected') &&
            record.artifact?.artifact_id === current.artifact_id &&
            record.artifact.revision === current.revision
          ) {
            const { artifact: _artifact, ...scrubbed } = record;
            this.methodologyProposals.set(proposalKey, scrubbed);
          }
        }
        purged += 1;
      });
    }
    return purged;
  }

  // ----- Methodology proposals -----
  async listMethodologyProposals(
    opts: { org?: string; project?: string; status?: MethodologyProposal['status'] } = {},
  ): Promise<MethodologyProposalRecord[]> {
    let out = this.visible(this.methodologyProposals, opts).map((record) =>
      parseMethodologyProposalRecord(JSON.parse(JSON.stringify(record))),
    );
    out = out.filter(
      (record) => record.proposal.status === 'pending' || record.artifact !== undefined,
    );
    if (opts.status) out = out.filter((record) => record.proposal.status === opts.status);
    return out.sort((a, b) => (a.proposal.proposed_at < b.proposal.proposed_at ? 1 : -1));
  }
  async loadMethodologyProposal(
    proposalId: string,
    scope?: StoreScope,
  ): Promise<MethodologyProposalRecord | null> {
    const record = this.methodologyProposals.get(this.key(proposalId, scope));
    return record ? parseMethodologyProposalRecord(JSON.parse(JSON.stringify(record))) : null;
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
    const key = this.key(normalized.proposal_id, scope);
    const existing = this.methodologyProposals.get(key);
    if (
      existing &&
      (JSON.stringify(existing.proposal) !== JSON.stringify(normalized) ||
        JSON.stringify(existing.artifact) !== JSON.stringify(normalizedArtifact))
    )
      throw new Error('methodology proposal conflict');
    this.methodologyProposals.set(key, {
      ...(existing ? JSON.parse(JSON.stringify(existing)) : {}),
      proposal: JSON.parse(JSON.stringify(normalized)),
      ...(normalizedArtifact ? { artifact: JSON.parse(JSON.stringify(normalizedArtifact)) } : {}),
    });
  }
  async approveMethodologyProposal(
    proposalId: string,
    approval: MethodologyApproval,
    scope?: StoreScope,
  ): Promise<MethodologyApprovalResult | null> {
    const key = this.key(proposalId, scope);
    const existing = this.methodologyProposals.get(key);
    if (!existing) return null;
    const result = approveMethodologyProposal(
      existing.proposal,
      parseMethodologyApproval(approval),
    );
    this.methodologyProposals.set(key, {
      ...(existing?.artifact ? { artifact: JSON.parse(JSON.stringify(existing.artifact)) } : {}),
      proposal: result.proposal,
      approval: JSON.parse(JSON.stringify(result.approval)),
    });
    return JSON.parse(JSON.stringify(result)) as MethodologyApprovalResult;
  }
  async rejectMethodologyProposal(
    proposalId: string,
    rejection: MethodologyRejection,
    scope?: StoreScope,
  ): Promise<MethodologyRejectionResult | null> {
    const key = this.key(proposalId, scope);
    const existing = this.methodologyProposals.get(key);
    if (!existing) return null;
    const result = rejectMethodologyProposal(
      existing.proposal,
      parseMethodologyRejection(rejection),
    );
    this.methodologyProposals.set(key, {
      ...(existing.artifact ? { artifact: JSON.parse(JSON.stringify(existing.artifact)) } : {}),
      proposal: result.proposal,
      ...(existing.approval ? { approval: JSON.parse(JSON.stringify(existing.approval)) } : {}),
      rejection: JSON.parse(JSON.stringify(result.rejection)),
    });
    return JSON.parse(JSON.stringify(result)) as MethodologyRejectionResult;
  }

  // ----- Scenarios -----
  async listScenarios(
    opts: { pack?: string; risk_id?: string; org?: string; project?: string } = {},
  ): Promise<Scenario.Scenario[]> {
    let out = this.visible(this.scenarios, opts);
    const riskId = opts.risk_id;
    if (riskId) out = out.filter((s) => s.risk_refs.includes(riskId));
    return out;
  }
  async loadScenario(id: string, scope?: StoreScope): Promise<Scenario.Scenario | null> {
    return this.scenarios.get(this.key(id, scope)) ?? null;
  }
  async saveScenario(scenario: Scenario.Scenario, scope?: StoreScope): Promise<void> {
    this.scenarios.set(this.key(scenario.id, scope), scenario);
  }
  async createScenario(
    scenario: Scenario.Scenario,
    scope?: StoreScope,
  ): Promise<{ created: boolean }> {
    const key = this.key(scenario.id, scope);
    if (this.scenarios.has(key)) return { created: false };
    this.scenarios.set(key, scenario);
    return { created: true };
  }
  async deleteScenario(id: string, scope?: StoreScope): Promise<void> {
    this.scenarios.delete(this.key(id, scope));
  }

  async migrateLegacyConfiguration(scope: StoreScope) {
    if (!scope.org && !scope.project)
      throw new Error('legacy migration requires an org or project destination');
    const resources = [
      ['pack', this.packs],
      ['profile', this.profiles],
      ['risk', this.risks],
      ['scenario', this.scenarios],
    ] as unknown as Array<[string, Map<string, unknown>]>;
    const conflicts: string[] = [];
    let skipped = 0;
    for (const [kind, map] of resources) {
      for (const key of map.keys()) {
        if (isScopedRecordKey(key)) continue;
        const target = this.key(key, scope);
        if (map.has(target)) conflicts.push(`${kind}:${key}`);
        else skipped += 1;
      }
    }
    if (conflicts.length > 0) return { migrated: 0, skipped, conflicts };
    let migrated = 0;
    for (const [, map] of resources) {
      for (const [key, value] of [...map.entries()]) {
        if (isScopedRecordKey(key)) continue;
        map.set(this.key(key, scope), value);
        map.delete(key);
        migrated += 1;
      }
    }
    return { migrated, skipped: 0, conflicts: [] };
  }

  // ----- Agents (v1.7 slice 4d) -----
  async listAgents(): Promise<Agent.Agent[]> {
    return [...this.agents.values()];
  }
  async loadAgent(id: string): Promise<Agent.Agent | null> {
    return this.agents.get(id) ?? null;
  }
  async installAgent(id: string): Promise<Agent.Agent | null> {
    const a = this.agents.get(id);
    if (!a) return null;
    const updated: Agent.Agent = {
      ...a,
      installed: true,
      last_updated: new Date().toISOString(),
    };
    this.agents.set(id, updated);
    return updated;
  }
  async uninstallAgent(id: string): Promise<Agent.Agent | null> {
    const a = this.agents.get(id);
    if (!a) return null;
    const updated: Agent.Agent = { ...a, installed: false };
    this.agents.set(id, updated);
    return updated;
  }
  // __test-namespaced helpers — only for unit/integration tests. They
  // sit OUTSIDE the StoreProvider contract so production code can't
  // import them inadvertently (a future TypeScript-strict consumer
  // would flag the access). PR #38 Copilot iter 2.
  __test_seedAgent(a: Agent.Agent): void {
    this.agents.set(a.id, a);
  }
  __test_seedUser(u: StoreUserDirectoryEntry): void {
    this.users.set(u.id, u);
  }

  // ----- Users (v1.7 slice 4g) -----
  async listUsers(scope?: { org?: string; project?: string }): Promise<StoreUserDirectoryEntry[]> {
    if (!scope?.org && !scope?.project) return [...this.users.values()];
    const prefix = scopedRecordKey('', scope);
    return [...this.users.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, user]) => user);
  }
  async upsertUser(
    user: StoreUserDirectoryEntry,
    scope?: { org?: string; project?: string },
  ): Promise<void> {
    this.users.set(scopedRecordKey(user.id, scope), user);
  }

  // ----- SSO config (v1.7 slice 4h) -----
  async loadSsoConfig(): Promise<SsoConfig.SsoConfig | null> {
    return this.ssoConfig;
  }
  async saveSsoConfig(config: SsoConfig.SsoConfig): Promise<void> {
    this.ssoConfig = config;
  }

  __test_seedSsoConfig(config: SsoConfig.SsoConfig): void {
    this.ssoConfig = config;
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
    this.methodologyArtifacts.clear();
    this.methodologyArtifactLifecycles.clear();
    this.methodologyLifecycleLocks.clear();
    this.methodologyProposals.clear();
    this.agents.clear();
    this.users.clear();
    this.notifications = [];
    this.savedViews.clear();
    this.tokens.clear();
    this.orgs.clear();
    this.projects.clear();
    this.ssoConfig = null;
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
