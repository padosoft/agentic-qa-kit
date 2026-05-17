# ADR-002 — Three-level replay contract for findings

- **Status:** Accepted
- **Date:** 2026-05-17
- **Tags:** determinism / schema

## Context

"Reproducible: true" is ambiguous when an LLM is one of the actors. The same
bug can be:

1. Deterministically reproducible at the bug level (a curl trace replays it).
2. Deterministically reproducible at the scenario level (the runner replays
   the same scenario with a seed and the bug appears).
3. Statistically reproducible at the agent level (the same prompt finds the
   bug 6 times out of 10).

Conflating these three breaks audit trust and triage.

## Decision

`Finding.reproducibility` is split into three explicit sub-records:

```ts
{
  bug_level?:      { deterministic, attempts, successes, artifact_path? },
  scenario_level?: { deterministic, attempts, successes, seed? },
  agent_level?:    { deterministic, attempts, successes, model_pinned? },
}
```

`Finding.verification_floor` declares which level gates `status: 'verified'`.
A Zod `superRefine` rejects `status: 'verified'` unless the declared floor is
deterministic. The emitted JSON Schema mirrors the rule via `allOf` of
`if/then` clauses, one per floor.

## Consequences

- Auditors can ask "which floor does this finding claim?" and trust the answer.
- Release-gate findings demand `bug_level.deterministic: true` by convention.
- Agent-discovered bugs are still useful — they live at `agent_level` until
  someone writes a bug-level repro.

## Alternatives considered

- **Single `reproducible: bool`.** Rejected: loses the distinction described
  above.
- **Confidence number only.** Rejected: confidence answers "how sure are we?"
  not "what evidence underpins the claim?".
