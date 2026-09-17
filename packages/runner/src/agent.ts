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

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalise(value), 'utf8').digest('hex');
}

export interface AgentTool {
  name: string;
  run: (input: unknown, signal?: AbortSignal) => Promise<unknown>;
}

export interface AgentToolGuardOptions {
  tools: readonly AgentTool[];
  max_calls: number;
  max_output_bytes?: number;
  events: EventChainWriter;
  run_id: string;
  scenario_id: string;
  agent_id?: string;
  model?: string;
}

export interface AgentToolCallResult {
  ok: boolean;
  output?: unknown;
  error?:
    | 'tool_not_allowed'
    | 'call_budget_exceeded'
    | 'cancelled'
    | 'output_too_large'
    | 'tool_failed';
  call_index: number;
}

/**
 * Runtime gate for host-owned agent tools.
 *
 * The guard is deliberately provider-neutral: an MCP, HTTP, CLI or in-process
 * adapter can register tools, but every call crosses the same allowlist and
 * budget boundary. Audit events contain hashes and bounded metadata only; the
 * raw tool input/output stays in the host's controlled memory.
 */
export class AgentToolGuard {
  private readonly tools: ReadonlyMap<string, AgentTool>;
  private readonly maxCalls: number;
  private readonly maxOutputBytes: number;
  private readonly events: EventChainWriter;
  private readonly runId: string;
  private readonly scenarioId: string;
  private readonly agentId: string;
  private readonly model: string | undefined;
  private calls = 0;

  constructor(options: AgentToolGuardOptions) {
    if (!Number.isSafeInteger(options.max_calls) || options.max_calls < 1) {
      throw new Error('agent tool max_calls must be a positive safe integer');
    }
    const maxOutputBytes = options.max_output_bytes ?? 1_048_576;
    if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1) {
      throw new Error('agent tool max_output_bytes must be a positive safe integer');
    }
    const tools = new Map<string, AgentTool>();
    for (const tool of options.tools) {
      if (!tool.name.trim()) throw new Error('agent tool name must not be empty');
      if (tools.has(tool.name)) throw new Error(`duplicate agent tool: ${tool.name}`);
      tools.set(tool.name, tool);
    }
    this.tools = tools;
    this.maxCalls = options.max_calls;
    this.maxOutputBytes = maxOutputBytes;
    this.events = options.events;
    this.runId = options.run_id;
    this.scenarioId = options.scenario_id;
    this.agentId = options.agent_id ?? 'agent-driver';
    this.model = options.model;
  }

  get callCount(): number {
    return this.calls;
  }

  async call(name: string, input: unknown, signal?: AbortSignal): Promise<AgentToolCallResult> {
    const callIndex = this.calls;
    const inputHash = digest(input);
    if (!this.tools.has(name)) {
      this.record(name, callIndex, 'denied', {
        reason: 'tool_not_allowed',
        input_sha256: inputHash,
      });
      return { ok: false, error: 'tool_not_allowed', call_index: callIndex };
    }
    if (this.calls >= this.maxCalls) {
      this.record(name, callIndex, 'denied', {
        reason: 'call_budget_exceeded',
        input_sha256: inputHash,
      });
      return { ok: false, error: 'call_budget_exceeded', call_index: callIndex };
    }
    if (signal?.aborted) {
      this.record(name, callIndex, 'denied', { reason: 'cancelled', input_sha256: inputHash });
      return { ok: false, error: 'cancelled', call_index: callIndex };
    }

    this.calls += 1;
    const tool = this.tools.get(name) as AgentTool;
    try {
      const output = await tool.run(input, signal);
      if (signal?.aborted) {
        this.record(name, callIndex, 'failed', { reason: 'cancelled', input_sha256: inputHash });
        return { ok: false, error: 'cancelled', call_index: callIndex };
      }
      const outputBytes = new TextEncoder().encode(canonicalise(output)).byteLength;
      if (outputBytes > this.maxOutputBytes) {
        this.record(name, callIndex, 'failed', {
          reason: 'output_too_large',
          input_sha256: inputHash,
          output_bytes: outputBytes,
        });
        return { ok: false, error: 'output_too_large', call_index: callIndex };
      }
      this.record(name, callIndex, 'completed', {
        input_sha256: inputHash,
        output_sha256: digest(output),
        output_bytes: outputBytes,
      });
      return { ok: true, output, call_index: callIndex };
    } catch {
      this.record(name, callIndex, 'failed', { reason: 'tool_failed', input_sha256: inputHash });
      return { ok: false, error: 'tool_failed', call_index: callIndex };
    }
  }

  private record(
    toolName: string,
    callIndex: number,
    status: 'completed' | 'failed' | 'denied',
    payload: Record<string, unknown>,
  ): void {
    this.events.append({
      ts: new Date().toISOString(),
      run_id: this.runId,
      kind: 'tool_call',
      actor: { type: 'agent', id: this.agentId, ...(this.model ? { model: this.model } : {}) },
      scenario_id: this.scenarioId,
      payload: { tool_name: toolName, call_index: callIndex, status, ...payload },
    });
  }
}
