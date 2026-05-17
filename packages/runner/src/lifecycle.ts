export type RunStateName =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'aborted'
  | 'budget_exceeded';

const ALLOWED_TRANSITIONS: Record<RunStateName, readonly RunStateName[]> = {
  pending: ['running', 'aborted'],
  running: ['succeeded', 'failed', 'aborted', 'budget_exceeded'],
  succeeded: [],
  failed: [],
  aborted: [],
  budget_exceeded: [],
};

export function transitionAllowed(from: RunStateName, to: RunStateName): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Minimal state machine for a run lifecycle. The runner owns one instance per
 * run; each transition logs the previous→next pair so the events.jsonl audit
 * trail can reconstruct the full timeline.
 */
export class RunLifecycle {
  private current: RunStateName;
  private readonly transitions: Array<{ from: RunStateName; to: RunStateName; at: string }> = [];

  constructor(initial: RunStateName = 'pending') {
    this.current = initial;
  }

  get state(): RunStateName {
    return this.current;
  }

  get history(): ReadonlyArray<{ from: RunStateName; to: RunStateName; at: string }> {
    return this.transitions;
  }

  transition(to: RunStateName, now: Date = new Date()): void {
    if (!transitionAllowed(this.current, to)) {
      throw new Error(`[runner] illegal transition: ${this.current} → ${to}`);
    }
    this.transitions.push({ from: this.current, to, at: now.toISOString() });
    this.current = to;
  }

  isTerminal(): boolean {
    return ALLOWED_TRANSITIONS[this.current].length === 0;
  }
}
