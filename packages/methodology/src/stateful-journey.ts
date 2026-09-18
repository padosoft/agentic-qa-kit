import { createHash } from 'node:crypto';
import type { StateGraph, StateTransition } from './state-graph.js';
import { evaluateStatePath, validateStateGraph } from './state-graph.js';

const ACTOR_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const SAFE_CODE = /^[a-z0-9][a-z0-9_.-]{0,63}$/u;
const MAX_ACTORS = 64;
const MAX_OBSERVERS = 256;
const MAX_STEPS = 4_096;
const DEFAULT_TIMEOUT_MS = 120_000;

export interface JourneyActor {
  id: string;
}

export interface JourneyCheckResult {
  ok: boolean;
  /** A bounded operator-defined code; free-form provider errors are not retained. */
  code?: string;
  /** The authoritative application state observed after an action. */
  observed_state?: string;
}

export interface JourneyObserverInput {
  observer_id: string;
  transition: StateTransition;
  actor_id: string;
  history: ReadonlyArray<JourneyStepResult>;
  signal: AbortSignal;
}

export interface JourneyObserver {
  id: string;
  after_transition_id: string;
  check: (input: JourneyObserverInput) => Promise<JourneyCheckResult>;
}

export interface StatefulJourneyDefinition {
  schema_version: '1';
  id: string;
  graph: StateGraph;
  transition_path: ReadonlyArray<string>;
  actors: ReadonlyArray<JourneyActor>;
  observers?: ReadonlyArray<JourneyObserver>;
  require_terminal?: boolean;
  max_duration_ms?: number;
}

export interface CompiledJourneyTransition {
  transition: StateTransition;
  actor_id: string;
}

export interface CompiledStatefulJourney {
  schema_version: '1';
  id: string;
  graph_id: string;
  initial_state: string;
  reached_state: string;
  transitions: ReadonlyArray<CompiledJourneyTransition>;
  observers: ReadonlyArray<JourneyObserver>;
  digest: string;
  max_duration_ms: number;
}

export interface JourneyActionInput<TContext = unknown> {
  journey_id: string;
  transition: StateTransition;
  actor_id: string;
  context: TContext;
  history: ReadonlyArray<JourneyStepResult>;
  signal: AbortSignal;
}

export type JourneyAction<TContext = unknown> = (
  input: JourneyActionInput<TContext>,
) => Promise<JourneyCheckResult>;

export interface JourneyCleanupInput<TContext = unknown> {
  journey_id: string;
  contexts: Readonly<Record<string, TContext>>;
  history: ReadonlyArray<JourneyStepResult>;
  signal: AbortSignal;
}

export type JourneyCleanup<TContext = unknown> = (
  input: JourneyCleanupInput<TContext>,
) => Promise<JourneyCheckResult | undefined>;

export interface JourneyStepResult {
  transition_id: string;
  actor_id: string;
  from: string;
  to: string;
  ok: boolean;
  started_at: string;
  ended_at: string;
  code?: string;
}

export interface JourneyObserverResult {
  observer_id: string;
  transition_id: string;
  ok: boolean;
  code?: string;
}

export interface StatefulJourneyExecution {
  journey_id: string;
  digest: string;
  status: 'succeeded' | 'failed' | 'aborted';
  reached_state: string;
  steps: ReadonlyArray<JourneyStepResult>;
  observers: ReadonlyArray<JourneyObserverResult>;
  cleanup: { attempted: boolean; ok: boolean; code?: string };
  failure?: { phase: 'action' | 'observer' | 'cleanup' | 'timeout'; code: string; id?: string };
}

function safeCode(value: string | undefined, fallback: string): string {
  return value && SAFE_CODE.test(value) ? value : fallback;
}

function normalizeCheckResult(value: unknown, fallback: string): JourneyCheckResult {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return { ok: false, code: fallback };
  const item = value as Record<string, unknown>;
  return {
    ok: item.ok === true,
    ...(typeof item.code === 'string' ? { code: item.code } : {}),
    ...(typeof item.observed_state === 'string' ? { observed_state: item.observed_state } : {}),
  };
}

function boundedDuration(value: number | undefined): number {
  const duration = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(duration) || duration < 1 || duration > 600_000)
    throw new Error('stateful journey max_duration_ms must be an integer from 1 to 600000');
  return duration;
}

function digestPlan(
  id: string,
  graphId: string,
  transitions: ReadonlyArray<CompiledJourneyTransition>,
  observers: ReadonlyArray<JourneyObserver>,
): string {
  const canonical = JSON.stringify({
    id,
    graph_id: graphId,
    transitions: transitions.map(({ transition, actor_id }) => ({
      id: transition.id,
      from: transition.from,
      to: transition.to,
      actor: transition.actor,
      action: transition.action,
      actor_id,
    })),
    observers: observers.map((observer) => ({
      id: observer.id,
      after_transition_id: observer.after_transition_id,
    })),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/** Compile a validated graph path into an executable, actor-bound runtime plan. */
export function compileStatefulJourney(
  definition: StatefulJourneyDefinition,
): CompiledStatefulJourney {
  if (definition.schema_version !== '1')
    throw new Error('stateful journey schema_version must be "1"');
  if (!ACTOR_ID.test(definition.id))
    throw new Error(`invalid stateful journey id: ${definition.id}`);
  validateStateGraph(definition.graph);
  if (
    !Array.isArray(definition.transition_path) ||
    definition.transition_path.length === 0 ||
    definition.transition_path.length > MAX_STEPS
  )
    throw new Error(`stateful journey transition_path must contain 1..${MAX_STEPS} transitions`);
  if (
    !Array.isArray(definition.actors) ||
    definition.actors.length === 0 ||
    definition.actors.length > MAX_ACTORS
  )
    throw new Error(`stateful journey actors must contain 1..${MAX_ACTORS} actors`);

  const actors = new Set<string>();
  for (const actor of definition.actors) {
    if (!ACTOR_ID.test(actor.id)) throw new Error(`invalid journey actor id: ${actor.id}`);
    if (actors.has(actor.id)) throw new Error(`duplicate journey actor id: ${actor.id}`);
    actors.add(actor.id);
  }
  const path = evaluateStatePath(definition.graph, definition.transition_path);
  if (!path.valid)
    throw new Error(`stateful journey path is invalid: ${path.violations.join('; ')}`);
  const transitionById = new Map(
    definition.graph.transitions.map((transition) => [transition.id, transition]),
  );
  const transitions = definition.transition_path.map((id) => {
    const transition = transitionById.get(id) as StateTransition;
    if (!actors.has(transition.actor))
      throw new Error(`transition ${id} has no bound actor context: ${transition.actor}`);
    return { transition, actor_id: transition.actor };
  });
  const finalState = definition.graph.states.find((state) => state.id === path.reached_state);
  if (definition.require_terminal !== false && finalState?.terminal !== true)
    throw new Error(`stateful journey must end in a terminal state: ${path.reached_state}`);

  const observers = definition.observers ?? [];
  if (observers.length > MAX_OBSERVERS)
    throw new Error(`stateful journey has more than ${MAX_OBSERVERS} observers`);
  const pathIds = new Set(definition.transition_path);
  const observerIds = new Set<string>();
  for (const observer of observers) {
    if (!ACTOR_ID.test(observer.id)) throw new Error(`invalid journey observer id: ${observer.id}`);
    if (observerIds.has(observer.id))
      throw new Error(`duplicate journey observer id: ${observer.id}`);
    if (!pathIds.has(observer.after_transition_id))
      throw new Error(`observer ${observer.id} references a transition outside the path`);
    observerIds.add(observer.id);
  }
  return {
    schema_version: '1',
    id: definition.id,
    graph_id: definition.graph.id,
    initial_state: definition.graph.initial_state,
    reached_state: path.reached_state,
    transitions,
    observers,
    digest: digestPlan(definition.id, definition.graph.id, transitions, observers),
    max_duration_ms: boundedDuration(definition.max_duration_ms),
  };
}

function isoNow(): string {
  return new Date().toISOString();
}

/** Execute a compiled path with actor isolation, temporal observers and guaranteed cleanup. */
export async function executeStatefulJourney<TContext>(
  plan: CompiledStatefulJourney,
  contexts: Readonly<Record<string, TContext>>,
  action: JourneyAction<TContext>,
  cleanup: JourneyCleanup<TContext>,
  signal?: AbortSignal,
): Promise<StatefulJourneyExecution> {
  for (const transition of plan.transitions) {
    if (!Object.prototype.hasOwnProperty.call(contexts, transition.actor_id))
      throw new Error(`missing context for journey actor: ${transition.actor_id}`);
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, plan.max_duration_ms);
  const steps: JourneyStepResult[] = [];
  const observerResults: JourneyObserverResult[] = [];
  const observersByTransition = new Map<string, JourneyObserver[]>();
  for (const observer of plan.observers) {
    const list = observersByTransition.get(observer.after_transition_id) ?? [];
    list.push(observer);
    observersByTransition.set(observer.after_transition_id, list);
  }
  let status: StatefulJourneyExecution['status'] = 'succeeded';
  let reachedState = plan.initial_state;
  let failure: StatefulJourneyExecution['failure'];

  try {
    for (const planned of plan.transitions) {
      if (controller.signal.aborted) {
        status = 'aborted';
        failure = { phase: 'timeout', code: 'journey_aborted' };
        break;
      }
      const startedAt = isoNow();
      let result: JourneyCheckResult;
      try {
        const rawResult = await action({
          journey_id: plan.id,
          transition: planned.transition,
          actor_id: planned.actor_id,
          context: contexts[planned.actor_id] as TContext,
          history: steps,
          signal: controller.signal,
        });
        result = normalizeCheckResult(rawResult, 'action_invalid_result');
      } catch {
        result = { ok: false, code: 'action_exception' };
      }
      const step: JourneyStepResult = {
        transition_id: planned.transition.id,
        actor_id: planned.actor_id,
        from: planned.transition.from,
        to: planned.transition.to,
        ok: result.ok === true && result.observed_state === planned.transition.to,
        started_at: startedAt,
        ended_at: isoNow(),
        ...(!result.ok ? { code: safeCode(result.code, 'action_rejected') } : {}),
      };
      steps.push(step);
      if (controller.signal.aborted) {
        status = 'aborted';
        failure = { phase: 'timeout', code: 'journey_timeout', id: planned.transition.id };
        break;
      }
      if (!step.ok) {
        status = 'failed';
        failure = {
          phase: 'action',
          code:
            result.ok === true
              ? 'observed_state_mismatch'
              : safeCode(result.code, 'action_rejected'),
          id: planned.transition.id,
        };
        break;
      }
      reachedState = planned.transition.to;
      for (const observer of observersByTransition.get(planned.transition.id) ?? []) {
        let observed: JourneyCheckResult;
        try {
          const rawObserved = await observer.check({
            observer_id: observer.id,
            transition: planned.transition,
            actor_id: planned.actor_id,
            history: steps,
            signal: controller.signal,
          });
          observed = normalizeCheckResult(rawObserved, 'observer_invalid_result');
        } catch {
          observed = { ok: false, code: 'observer_exception' };
        }
        const observerResult: JourneyObserverResult = {
          observer_id: observer.id,
          transition_id: planned.transition.id,
          ok: observed.ok === true,
          ...(!observed.ok ? { code: safeCode(observed.code, 'observer_rejected') } : {}),
        };
        observerResults.push(observerResult);
        if (!observerResult.ok) {
          status = 'failed';
          failure = {
            phase: 'observer',
            code: observerResult.code ?? 'observer_rejected',
            id: observer.id,
          };
          break;
        }
      }
      if (failure) break;
    }
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }

  let cleanupResult: StatefulJourneyExecution['cleanup'] = { attempted: true, ok: true };
  try {
    const result = await cleanup({
      journey_id: plan.id,
      contexts,
      history: steps,
      signal: controller.signal,
    });
    if (result?.ok === false) {
      cleanupResult = {
        attempted: true,
        ok: false,
        code: safeCode(result.code, 'cleanup_rejected'),
      };
      if (status === 'succeeded') {
        status = 'failed';
        failure = { phase: 'cleanup', code: cleanupResult.code ?? 'cleanup_rejected' };
      }
    }
  } catch {
    cleanupResult = { attempted: true, ok: false, code: 'cleanup_exception' };
    if (status === 'succeeded') {
      status = 'failed';
      failure = { phase: 'cleanup', code: 'cleanup_exception' };
    }
  }
  return {
    journey_id: plan.id,
    digest: plan.digest,
    status,
    reached_state: reachedState,
    steps,
    observers: observerResults,
    cleanup: cleanupResult,
    ...(failure ? { failure } : {}),
  };
}
