# @aqa/methodology

Maps `agentic-qa-kit` risks to STRIDE / FMEA / OWASP — the methodology layer
auditors and architects expect (Task 21).

- `strideOf(risk)` — STRIDE categories inferred from `risk.category`.
- `fmeaScore(risk, detection?)` — RPN = severity × occurrence × detection.
- `owaspOf(risk)` — extracts `owasp:aNN` and `owasp-agentic:aNN` from tags.
- `methodologyCheck(riskMap)` — runs all three; flags risks with no anchor
- `validateStateGraph(graph)` / `evaluateStatePath(graph, ids)` — validate
  bounded stateful journey topology and replay a declared transition path
  without executing side effects
- `compileStatefulJourney(definition)` — bind a legal path to bounded actor
  contexts, terminal-state policy and temporal observers, producing a stable
  plan digest.
- `executeStatefulJourney(plan, contexts, action, cleanup)` — execute the plan
  through injected runtime actions, require authoritative observed state after
  every transition, run temporal observers, enforce abort/timeout signalling
  and run cleanup after action or observer failure.

State graphs reject unknown endpoints, duplicate IDs, unreachable states,
non-terminal dead ends and transitions out of terminal states. Path evaluation
is a static contract boundary: it does not claim that an external system
actually performed the actions or reached the observed state.

The runtime executor never stores actor context values or provider exception
text in its result. Action and observer callbacks must cooperate with the
provided `AbortSignal`; a non-cooperative provider adapter remains a boundary
that must be isolated by the runner sandbox.
  (smell — auditors cannot trace them back to a standard catalog).
- `riskCoverage(observation)` — computes the documented weighted coverage
  score and returns `covered`, `partial`, `gap` or `stale` plus drift alerts.
- `measureRiskCoverage(input)` — derives observations from a risk map,
  scenario links and bounded run history; missing artifacts remain gaps.
