const STATE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const MAX_STATES = 256;
const MAX_TRANSITIONS = 1_024;
const MAX_PATH = 4_096;

export interface StateNode {
  id: string;
  terminal?: boolean;
}

export interface StateTransition {
  id: string;
  from: string;
  to: string;
  actor: string;
  action: string;
}

export interface StateGraph {
  schema_version: '1';
  id: string;
  initial_state: string;
  states: ReadonlyArray<StateNode>;
  transitions: ReadonlyArray<StateTransition>;
}

export interface StateGraphValidation {
  state_count: number;
  transition_count: number;
  reachable_states: ReadonlyArray<string>;
  unreachable_states: ReadonlyArray<string>;
  dead_end_states: ReadonlyArray<string>;
}

export interface StatePathResult {
  valid: boolean;
  reached_state: string;
  traversed: ReadonlyArray<string>;
  violations: ReadonlyArray<string>;
}

function boundedText(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 512)
    throw new Error(`${field} must be bounded and non-empty`);
  return trimmed;
}

/** Validate a bounded state graph before a journey compiler or runner consumes it. */
export function validateStateGraph(graph: StateGraph): StateGraphValidation {
  if (graph.schema_version !== '1') throw new Error('state graph schema_version must be "1"');
  boundedText(graph.id, 'state graph id');
  if (!Array.isArray(graph.states) || graph.states.length === 0 || graph.states.length > MAX_STATES)
    throw new Error(`state graph states must contain 1..${MAX_STATES} states`);
  if (!Array.isArray(graph.transitions) || graph.transitions.length > MAX_TRANSITIONS)
    throw new Error(`state graph transitions must contain at most ${MAX_TRANSITIONS} transitions`);
  if (!STATE_ID.test(graph.initial_state))
    throw new Error(`invalid initial state: ${graph.initial_state}`);

  const states = new Map<string, StateNode>();
  for (const state of graph.states) {
    if (!STATE_ID.test(state.id)) throw new Error(`invalid state id: ${state.id}`);
    if (states.has(state.id)) throw new Error(`duplicate state id: ${state.id}`);
    states.set(state.id, state);
  }
  if (!states.has(graph.initial_state))
    throw new Error(`initial state is not declared: ${graph.initial_state}`);

  const transitions = new Map<string, StateTransition>();
  const outgoing = new Map<string, number>();
  for (const transition of graph.transitions) {
    boundedText(transition.id, 'state transition id');
    boundedText(transition.actor, `state transition ${transition.id} actor`);
    boundedText(transition.action, `state transition ${transition.id} action`);
    if (!STATE_ID.test(transition.from) || !STATE_ID.test(transition.to))
      throw new Error(`state transition ${transition.id} has an invalid endpoint`);
    if (!states.has(transition.from) || !states.has(transition.to))
      throw new Error(`state transition ${transition.id} references an unknown state`);
    if (transitions.has(transition.id))
      throw new Error(`duplicate transition id: ${transition.id}`);
    if (states.get(transition.from)?.terminal === true)
      throw new Error(`terminal state cannot have outgoing transition: ${transition.from}`);
    transitions.set(transition.id, transition);
    outgoing.set(transition.from, (outgoing.get(transition.from) ?? 0) + 1);
  }

  const reachable = new Set<string>([graph.initial_state]);
  const queue = [graph.initial_state];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const transition of graph.transitions) {
      if (transition.from !== current || reachable.has(transition.to)) continue;
      reachable.add(transition.to);
      queue.push(transition.to);
    }
  }
  const unreachable_states = graph.states
    .map((state) => state.id)
    .filter((id) => !reachable.has(id));
  const dead_end_states = graph.states
    .filter((state) => state.terminal !== true && !outgoing.has(state.id))
    .map((state) => state.id);
  if (unreachable_states.length > 0)
    throw new Error(`state graph contains unreachable states: ${unreachable_states.join(', ')}`);
  if (dead_end_states.length > 0)
    throw new Error(`state graph contains non-terminal dead ends: ${dead_end_states.join(', ')}`);
  return {
    state_count: graph.states.length,
    transition_count: graph.transitions.length,
    reachable_states: [...reachable],
    unreachable_states,
    dead_end_states,
  };
}

/** Replay a declared transition path without executing its actions. */
export function evaluateStatePath(
  graph: StateGraph,
  transitionIds: ReadonlyArray<string>,
): StatePathResult {
  validateStateGraph(graph);
  if (transitionIds.length > MAX_PATH)
    throw new Error(`state path exceeds ${MAX_PATH} transitions`);
  const transitions = new Map(graph.transitions.map((transition) => [transition.id, transition]));
  let current = graph.initial_state;
  const traversed: string[] = [];
  const violations: string[] = [];
  for (const id of transitionIds) {
    const transition = transitions.get(id);
    if (!transition) {
      violations.push(`unknown transition: ${id}`);
      continue;
    }
    if (transition.from !== current) {
      violations.push(`transition ${id} expects ${transition.from}, current state is ${current}`);
      continue;
    }
    traversed.push(id);
    current = transition.to;
  }
  return { valid: violations.length === 0, reached_state: current, traversed, violations };
}
