import { createHash } from 'node:crypto';
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
