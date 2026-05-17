export type SandboxKind = 'process' | 'container';

export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface ToolCallBudget {
  /** Hard maximum tool calls per scenario. */
  max_calls: number;
  /** Hard timeout per single call in milliseconds. */
  per_call_timeout_ms: number;
}

export interface Sandbox {
  kind: SandboxKind;
  /**
   * Execute a tool call inside the sandbox. Implementations enforce per-call
   * timeout and report the result; callers enforce the higher-level
   * `max_calls` budget against the Sandbox.callCount() snapshot.
   */
  invoke(call: ToolCall): Promise<{ ok: boolean; output?: unknown; error?: string }>;
  callCount(): number;
  budget(): ToolCallBudget;
}
