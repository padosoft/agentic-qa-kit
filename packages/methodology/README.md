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

State graphs reject unknown endpoints, duplicate IDs, unreachable states,
non-terminal dead ends and transitions out of terminal states. Path evaluation
is a static contract boundary: it does not claim that an external system
actually performed the actions or reached the observed state.
  (smell — auditors cannot trace them back to a standard catalog).
- `riskCoverage(observation)` — computes the documented weighted coverage
  score and returns `covered`, `partial`, `gap` or `stale` plus drift alerts.
- `measureRiskCoverage(input)` — derives observations from a risk map,
  scenario links and bounded run history; missing artifacts remain gaps.
