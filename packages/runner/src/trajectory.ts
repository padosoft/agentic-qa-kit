import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { Event } from '@aqa/schemas';
import postgres from 'postgres';
import type { Sql } from 'postgres';
import type { EventChainWriter } from './events.js';

function canonicalise(value: unknown): string {
  try {
    return (
      JSON.stringify(value, (_key, nested) => {
        if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
          return Object.keys(nested as object)
            .sort()
            .reduce<Record<string, unknown>>((out, key) => {
              out[key] = (nested as Record<string, unknown>)[key];
              return out;
            }, {});
        }
        return nested;
      }) ?? 'null'
    );
  } catch {
    return '[unserializable]';
  }
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalise(value), 'utf8').digest('hex');
}

export function agentTrajectoryDigest(snapshot: AgentTrajectorySnapshot): string {
  return sha256(snapshot);
}

export interface AgentTrajectoryArtifact {
  path: string;
  digest: string;
}

export interface AgentTrajectoryStoreOptions {
  root: string;
  max_bytes?: number;
}

interface StoredTrajectoryEnvelope {
  schema_version: '1';
  snapshot: AgentTrajectorySnapshot;
  snapshot_sha256: string;
}

function safeSegment(value: string, field: string): string {
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(value) || value.length > 256)
    throw new Error(`${field} must be a safe lowercase path segment`);
  return value;
}

/** Local durable sink; the same envelope can be placed on WORM/S3 storage. */
export class AgentTrajectoryStore {
  private readonly root: string;
  private readonly maxBytes: number;

  constructor(options: AgentTrajectoryStoreOptions) {
    if (!options.root.trim()) throw new Error('trajectory store root is required');
    this.root = options.root;
    this.maxBytes = options.max_bytes ?? 1_048_576;
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes < 1)
      throw new Error('trajectory store max_bytes must be a positive safe integer');
  }

  save(snapshot: AgentTrajectorySnapshot): AgentTrajectoryArtifact {
    if (!verifyAgentTrajectory(snapshot).ok) throw new Error('cannot persist invalid trajectory');
    const run = safeSegment(snapshot.run_id, 'run_id');
    const scenario = safeSegment(snapshot.scenario_id, 'scenario_id');
    const digest = agentTrajectoryDigest(snapshot);
    const envelope: StoredTrajectoryEnvelope = {
      schema_version: '1',
      snapshot,
      snapshot_sha256: digest,
    };
    const bytes = Buffer.byteLength(JSON.stringify(envelope), 'utf8');
    if (bytes > this.maxBytes) throw new Error('trajectory artifact exceeds byte budget');
    const directory = join(this.root, run);
    const path = join(directory, `${scenario}.trajectory.json`);
    mkdirSync(directory, { recursive: true });
    if (existsSync(path)) {
      const existing = this.read(path);
      if (existing.digest !== digest)
        throw new Error('trajectory artifact is immutable and already exists');
      return { path, digest };
    }
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(envelope), { encoding: 'utf8', flag: 'wx' });
      if (existsSync(path)) throw new Error('trajectory artifact is immutable and already exists');
      renameSync(temporary, path);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
    return { path, digest };
  }

  load(runId: string, scenarioId: string): AgentTrajectorySnapshot {
    const path = join(
      this.root,
      safeSegment(runId, 'run_id'),
      `${safeSegment(scenarioId, 'scenario_id')}.trajectory.json`,
    );
    return this.read(path).snapshot;
  }

  private read(path: string): { snapshot: AgentTrajectorySnapshot; digest: string } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      throw new Error('trajectory artifact cannot be read');
    }
    if (!parsed || typeof parsed !== 'object') throw new Error('trajectory artifact is malformed');
    const envelope = parsed as Partial<StoredTrajectoryEnvelope>;
    if (
      envelope.schema_version !== '1' ||
      !envelope.snapshot ||
      typeof envelope.snapshot_sha256 !== 'string'
    )
      throw new Error('trajectory artifact envelope is invalid');
    const digest = agentTrajectoryDigest(envelope.snapshot);
    if (digest !== envelope.snapshot_sha256 || !verifyAgentTrajectory(envelope.snapshot).ok)
      throw new Error('trajectory artifact integrity verification failed');
    return { snapshot: envelope.snapshot, digest };
  }
}

export interface PostgresTrajectoryStoreOptions {
  dsn?: string;
  client?: PostgresTrajectoryClient;
  max_bytes?: number;
}

export interface PostgresTrajectoryClient {
  unsafe(query: string, parameters?: unknown[]): Promise<unknown>;
  /** Optional transaction primitive; required for race-free production bootstrap. */
  begin?<T>(callback: (transaction: PostgresTrajectoryClient) => Promise<T>): Promise<T>;
}

interface StoredPostgresTrajectory {
  run_id: string;
  scenario_id: string;
  snapshot_sha256: string;
  envelope: unknown;
}

/** Cross-replica trajectory store with an immutable identity key. */
export class PostgresAgentTrajectoryStore {
  private readonly sql: PostgresTrajectoryClient;
  private readonly maxBytes: number;
  private readonly ownedClient: Sql | undefined;
  private readonly ready: Promise<void>;

  constructor(options: PostgresTrajectoryStoreOptions) {
    if (options.client) {
      this.sql = options.client;
    } else {
      if (!options.dsn?.trim()) throw new Error('trajectory PostgreSQL DSN is required');
      this.ownedClient = postgres(options.dsn, { max: 10, idle_timeout: 20, connect_timeout: 10 });
      this.sql = this.ownedClient as unknown as PostgresTrajectoryClient;
    }
    this.maxBytes = options.max_bytes ?? 1_048_576;
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes < 1)
      throw new Error('trajectory store max_bytes must be a positive safe integer');
    this.ready = this.migrate();
  }

  async save(snapshot: AgentTrajectorySnapshot): Promise<AgentTrajectoryArtifact> {
    await this.ready;
    const run = safeSegment(snapshot.run_id, 'run_id');
    const scenario = safeSegment(snapshot.scenario_id, 'scenario_id');
    if (!verifyAgentTrajectory(snapshot).ok) throw new Error('cannot persist invalid trajectory');
    const digest = agentTrajectoryDigest(snapshot);
    const envelope: StoredTrajectoryEnvelope = {
      schema_version: '1',
      snapshot,
      snapshot_sha256: digest,
    };
    const serialized = JSON.stringify(envelope);
    if (Buffer.byteLength(serialized, 'utf8') > this.maxBytes)
      throw new Error('trajectory artifact exceeds byte budget');
    const inserted = await this.query<{ snapshot_sha256: string }>(
      `INSERT INTO aqa_agent_trajectories
       (run_id, scenario_id, snapshot_sha256, envelope)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (run_id, scenario_id) DO NOTHING
       RETURNING snapshot_sha256`,
      [run, scenario, digest, serialized],
    );
    if (inserted[0]?.snapshot_sha256 === digest)
      return { path: this.artifactPath(run, scenario), digest };
    const existing = await this.query<StoredPostgresTrajectory>(
      `SELECT run_id, scenario_id, snapshot_sha256, envelope
       FROM aqa_agent_trajectories WHERE run_id = $1 AND scenario_id = $2`,
      [run, scenario],
    );
    const row = existing[0];
    if (!row) throw new Error('trajectory artifact insert did not persist');
    if (row.snapshot_sha256 !== digest)
      throw new Error('trajectory artifact is immutable and already exists');
    return { path: this.artifactPath(run, scenario), digest };
  }

  async load(runId: string, scenarioId: string): Promise<AgentTrajectorySnapshot> {
    await this.ready;
    const run = safeSegment(runId, 'run_id');
    const scenario = safeSegment(scenarioId, 'scenario_id');
    const rows = await this.query<StoredPostgresTrajectory>(
      `SELECT run_id, scenario_id, snapshot_sha256, envelope
       FROM aqa_agent_trajectories WHERE run_id = $1 AND scenario_id = $2`,
      [run, scenario],
    );
    const row = rows[0];
    if (!row) throw new Error('trajectory artifact cannot be read');
    const envelope = parseEnvelope(row.envelope);
    if (envelope.snapshot.run_id !== run || envelope.snapshot.scenario_id !== scenario)
      throw new Error('trajectory artifact identity mismatch');
    if (row.snapshot_sha256 !== envelope.snapshot_sha256)
      throw new Error('trajectory artifact database digest mismatch');
    const digest = agentTrajectoryDigest(envelope.snapshot);
    if (digest !== envelope.snapshot_sha256 || !verifyAgentTrajectory(envelope.snapshot).ok)
      throw new Error('trajectory artifact integrity verification failed');
    return envelope.snapshot;
  }

  async close(): Promise<void> {
    await this.ready;
    if (this.ownedClient) await this.ownedClient.end({ timeout: 5 });
  }

  private artifactPath(run: string, scenario: string): string {
    return `postgres:trajectory/${run}/${scenario}`;
  }

  private async migrate(): Promise<void> {
    const createTable = async (client: PostgresTrajectoryClient): Promise<void> => {
      await client.unsafe(
        `CREATE TABLE IF NOT EXISTS aqa_agent_trajectories (
          run_id text NOT NULL,
          scenario_id text NOT NULL,
          snapshot_sha256 text NOT NULL CHECK (snapshot_sha256 ~ '^[a-f0-9]{64}$'),
          envelope jsonb NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (run_id, scenario_id)
        )`,
      );
    };
    if (this.sql.begin) {
      await this.sql.begin(async (transaction) => {
        await transaction.unsafe(
          "SELECT pg_advisory_xact_lock(hashtext('aqa_agent_trajectories_migration'))",
        );
        await createTable(transaction);
      });
      return;
    }
    await createTable(this.sql);
  }

  private async query<T = unknown>(text: string, values: unknown[] = []): Promise<T[]> {
    return (await this.sql.unsafe(text, values)) as T[];
  }
}

function parseEnvelope(value: unknown): StoredTrajectoryEnvelope {
  let parsed: unknown;
  try {
    parsed = typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    throw new Error('trajectory artifact envelope is invalid');
  }
  if (!parsed || typeof parsed !== 'object')
    throw new Error('trajectory artifact envelope is invalid');
  const envelope = parsed as Partial<StoredTrajectoryEnvelope>;
  if (
    envelope.schema_version !== '1' ||
    !envelope.snapshot ||
    typeof envelope.snapshot_sha256 !== 'string'
  )
    throw new Error('trajectory artifact envelope is invalid');
  return envelope as StoredTrajectoryEnvelope;
}

export interface AgentModelIdentity {
  provider: string;
  model_id: string;
  model_version_hash?: string;
  api_version?: string;
  region?: string;
}

export interface AgentTokenUsage {
  input: number;
  output: number;
}

export interface AgentTrajectoryStep {
  seq: number;
  kind: 'llm_call' | 'tool_call';
  operation: string;
  status: 'completed' | 'failed' | 'denied';
  input_sha256: string;
  output_sha256?: string;
  input_tokens?: number;
  output_tokens?: number;
}

export interface AgentTrajectorySnapshot {
  schema_version: '1';
  run_id: string;
  scenario_id: string;
  agent_id: string;
  model: AgentModelIdentity;
  steps: readonly AgentTrajectoryStep[];
  totals: AgentTokenUsage;
}

export interface AgentTrajectoryRecorderOptions {
  events: EventChainWriter;
  run_id: string;
  scenario_id: string;
  agent_id?: string;
  model: AgentModelIdentity;
  max_steps: number;
  max_tokens?: number;
}

export interface RecordAgentCallOptions {
  operation: string;
  input: unknown;
  output?: unknown;
  status?: AgentTrajectoryStep['status'];
  usage?: AgentTokenUsage;
}

export interface AgentTrajectoryVerifyResult {
  ok: boolean;
  reason?: string;
}

const SHA256 = /^[a-f0-9]{64}$/u;

/**
 * Verify an opaque trajectory independently from the producer.
 *
 * When events are supplied, the verifier also binds every trajectory step to
 * the corresponding hash-chain event. A snapshot alone proves accounting and
 * digest shape; the event comparison proves that it was actually emitted by
 * the run being replayed.
 */
export function verifyAgentTrajectory(
  snapshot: AgentTrajectorySnapshot,
  events: readonly Event.Event[] = [],
): AgentTrajectoryVerifyResult {
  if (snapshot.schema_version !== '1')
    return { ok: false, reason: 'unsupported trajectory schema' };
  if (!snapshot.run_id || !snapshot.scenario_id || !snapshot.agent_id) {
    return { ok: false, reason: 'trajectory identity is incomplete' };
  }
  if (!snapshot.model.provider || !snapshot.model.model_id) {
    return { ok: false, reason: 'trajectory model identity is incomplete' };
  }
  if (
    !Number.isSafeInteger(snapshot.totals.input) ||
    snapshot.totals.input < 0 ||
    !Number.isSafeInteger(snapshot.totals.output) ||
    snapshot.totals.output < 0
  ) {
    return { ok: false, reason: 'trajectory token totals are invalid' };
  }
  let inputTotal = 0;
  let outputTotal = 0;
  for (const [index, step] of snapshot.steps.entries()) {
    if (step.seq !== index) return { ok: false, reason: 'trajectory sequence is not contiguous' };
    if (!step.operation.trim()) return { ok: false, reason: 'trajectory operation is empty' };
    if (!SHA256.test(step.input_sha256))
      return { ok: false, reason: 'trajectory input digest is invalid' };
    if (step.output_sha256 !== undefined && !SHA256.test(step.output_sha256)) {
      return { ok: false, reason: 'trajectory output digest is invalid' };
    }
    const input = step.input_tokens ?? 0;
    const output = step.output_tokens ?? 0;
    if (!Number.isSafeInteger(input) || input < 0 || !Number.isSafeInteger(output) || output < 0) {
      return { ok: false, reason: 'trajectory step token usage is invalid' };
    }
    inputTotal += input;
    outputTotal += output;
  }
  if (inputTotal !== snapshot.totals.input || outputTotal !== snapshot.totals.output) {
    return { ok: false, reason: 'trajectory token totals do not reconcile' };
  }
  if (events.length === 0) return { ok: true };
  const matching = events.filter(
    (event) =>
      event.run_id === snapshot.run_id &&
      event.scenario_id === snapshot.scenario_id &&
      event.actor.type === 'agent' &&
      (event.kind === 'llm_call' || event.kind === 'tool_call'),
  );
  if (matching.length !== snapshot.steps.length) {
    return { ok: false, reason: 'trajectory step count does not match audit events' };
  }
  for (const [index, step] of snapshot.steps.entries()) {
    const event = matching[index];
    if (!event) return { ok: false, reason: `trajectory event ${index} is missing` };
    if (event.kind !== step.kind)
      return { ok: false, reason: `trajectory event ${index} kind mismatch` };
    if (event.actor.id !== snapshot.agent_id) {
      return { ok: false, reason: `trajectory event ${index} agent identity mismatch` };
    }
    const payload = event.payload;
    if (
      payload.seq !== step.seq ||
      payload.operation !== step.operation ||
      payload.input_sha256 !== step.input_sha256 ||
      payload.status !== step.status ||
      (step.output_sha256 !== undefined && payload.output_sha256 !== step.output_sha256)
    ) {
      return { ok: false, reason: `trajectory event ${index} payload mismatch` };
    }
  }
  return { ok: true };
}

/**
 * Records an agent trajectory as an auditable, content-addressed summary.
 *
 * Model identity is pinned for the whole trajectory and all token/step budgets
 * are checked before an event is emitted. Raw prompts, completions and tool
 * payloads never enter the snapshot or the hash chain.
 */
export class AgentTrajectoryRecorder {
  private readonly options: AgentTrajectoryRecorderOptions;
  private readonly steps: AgentTrajectoryStep[] = [];
  private readonly totals: AgentTokenUsage = { input: 0, output: 0 };

  constructor(options: AgentTrajectoryRecorderOptions) {
    if (!options.run_id.trim() || !options.scenario_id.trim()) {
      throw new Error('agent trajectory requires run_id and scenario_id');
    }
    if (!options.agent_id?.trim() && options.agent_id !== undefined) {
      throw new Error('agent trajectory agent_id must not be empty');
    }
    if (!options.model.provider.trim() || !options.model.model_id.trim()) {
      throw new Error('agent trajectory model provider and model_id are required');
    }
    if (!Number.isSafeInteger(options.max_steps) || options.max_steps < 1) {
      throw new Error('agent trajectory max_steps must be a positive safe integer');
    }
    if (
      options.max_tokens !== undefined &&
      (!Number.isSafeInteger(options.max_tokens) || options.max_tokens < 1)
    ) {
      throw new Error('agent trajectory max_tokens must be a positive safe integer');
    }
    this.options = options;
  }

  get stepCount(): number {
    return this.steps.length;
  }

  recordLlmCall(options: RecordAgentCallOptions): AgentTrajectoryStep {
    return this.record({ ...options, kind: 'llm_call' });
  }

  recordToolCall(options: RecordAgentCallOptions): AgentTrajectoryStep {
    return this.record({ ...options, kind: 'tool_call' });
  }

  snapshot(): AgentTrajectorySnapshot {
    return {
      schema_version: '1',
      run_id: this.options.run_id,
      scenario_id: this.options.scenario_id,
      agent_id: this.options.agent_id ?? 'agent-driver',
      model: { ...this.options.model },
      steps: this.steps.map((step) => ({ ...step })),
      totals: { ...this.totals },
    };
  }

  private record(options: RecordAgentCallOptions & { kind: AgentTrajectoryStep['kind'] }) {
    if (!options.operation.trim()) throw new Error('agent trajectory operation must not be empty');
    if (this.steps.length >= this.options.max_steps) {
      throw new Error('agent trajectory step budget exceeded');
    }
    const usage = options.usage ?? { input: 0, output: 0 };
    if (
      !Number.isSafeInteger(usage.input) ||
      usage.input < 0 ||
      !Number.isSafeInteger(usage.output) ||
      usage.output < 0
    ) {
      throw new Error('agent trajectory token usage must be non-negative safe integers');
    }
    const nextTokens = this.totals.input + usage.input + this.totals.output + usage.output;
    if (this.options.max_tokens !== undefined && nextTokens > this.options.max_tokens) {
      throw new Error('agent trajectory token budget exceeded');
    }
    const status = options.status ?? 'completed';
    const step: AgentTrajectoryStep = {
      seq: this.steps.length,
      kind: options.kind,
      operation: options.operation,
      status,
      input_sha256: sha256(options.input),
      ...(options.output !== undefined ? { output_sha256: sha256(options.output) } : {}),
      ...(usage.input > 0 ? { input_tokens: usage.input } : {}),
      ...(usage.output > 0 ? { output_tokens: usage.output } : {}),
    };
    this.steps.push(step);
    this.totals.input += usage.input;
    this.totals.output += usage.output;
    this.options.events.append({
      ts: new Date().toISOString(),
      run_id: this.options.run_id,
      kind: options.kind,
      actor: {
        type: 'agent',
        id: this.options.agent_id ?? 'agent-driver',
        model: `${this.options.model.provider}/${this.options.model.model_id}`,
      },
      scenario_id: this.options.scenario_id,
      payload: {
        seq: step.seq,
        operation: step.operation,
        status: step.status,
        input_sha256: step.input_sha256,
        ...(step.output_sha256 ? { output_sha256: step.output_sha256 } : {}),
        ...(step.input_tokens ? { input_tokens: step.input_tokens } : {}),
        ...(step.output_tokens ? { output_tokens: step.output_tokens } : {}),
      },
    });
    return step;
  }
}
