# @aqa/compliance

SOC2 / ISO 27001 readiness layer for `agentic-qa-kit` (Task 23).

## What's here

- `CONTROL_MAPPINGS` — table mapping each shipped feature to SOC2 TSC
  criteria and ISO 27001:2022 Annex A controls. The auditor-facing
  source of truth.
- `controlsCoverage()` — summarizer that tells you which controls have
  at least one feature mapping. Use to spot coverage gaps before formal
  assessment.
- `verifyEventChain(events)` — hash-chain verifier for `events.jsonl`.
  Re-walks the sha256 chain and reports the first mismatch.
- `aqa-audit-verify <path>` — CLI wrapper around `verifyEventChain`.
  Exits non-zero on chain break — wire it into CI to fail builds on
  tampered audit logs.

## What's deferred to post-v1.0

- Automated evidence collection (auto-capturing artifacts per control).
- Pen-test report scaffolding integration with `@aqa/reporter`.
