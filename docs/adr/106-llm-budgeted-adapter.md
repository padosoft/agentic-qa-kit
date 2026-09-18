# ADR-106: enforce LLM cost budgets at the adapter boundary

- Status: Accepted
- Date: 2026-09-17

## Decision

`BudgetedLlmAdapter` decorates every `LlmAdapter` with a `BudgetTracker`.
Before dispatch it calls `assertCanDispatch` using a configurable estimate. On
successful provider response it charges the actual `tokens_in` and
`tokens_out`; if the tracker is exhausted, the decorator blocks further calls
and raises `BudgetDispatchBlockedError`. Provider failures are not charged.

The default estimate uses approximately four characters per input token and
`max_tokens` (or 4096) for output. Hosts should inject a tokenizer-aware
estimate and versioned pricing for production governance.

## Consequences

- Direct callers can no longer accidentally bypass per-run USD admission when
  they use the decorator.
- Actual provider usage remains the source of truth for aggregation.
- This is currently an in-process tracker for local admission. Durable
  org/project rollups and distributed reservation are supplied by
  `BudgetLedger`; the adapter now exposes bounded, prompt-free `llm_call` and
  `budget_exceeded` events through an injected sink. Hosts still must connect
  that sink to their hash-chain/event bus and reconcile it with provider billing.

## Verification

LLM adapter build and suite pass locally with **15 tests and 0 failures**.
