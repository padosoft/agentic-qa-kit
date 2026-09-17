# @aqa/generator

LLM-assisted scenario and risk-hypothesis generator with human-in-the-loop review queues.

- `proposeScenarios({ risk_id, invariant_statement, llm, queue, model })`
  asks the LLM for draft scenarios; only drafts that validate against
  `Scenario` enter the queue.
- `ReviewQueue` holds drafts in `pending`; `approve(id, reviewer)` /
  `reject(id, reviewer, rationale)` are the only ways out. Approved
  scenarios are returned by `approvedScenarios()` and pulled into the
  active profile by the runner.

Nothing flows into the active profile without explicit approval.

## Risk hypotheses

`proposeRisks({ scope, llm, queue, model })` asks an adapter for JSON risk
hypotheses and validates each result against `@aqa/schemas`. Valid hypotheses
are stored as `pending` in `RiskReviewQueue`, with provider/model metadata and
SHA-256 hashes of the prompt and response. The raw prompt and model response
are not persisted, and generated fields are redacted with the shared DLP policy
before they are queued. `approve(id, reviewer)` and `reject(id, reviewer, rationale)`
are the only terminal transitions; this API never mutates a project `RiskMap`.

## Setup

From the repository root:

```bash
bun install
bun run --cwd packages/generator build
bun test packages/generator/test/queue.test.ts
```
