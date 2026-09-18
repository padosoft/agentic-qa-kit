# ADR-258 — Protected live gift-card provider evidence

## Status

Accepted — 2026-09-18

## Context

The typed gift-card reconciliation and HTTP adapter proved local contracts,
but fixtures cannot prove that an operator-owned issuer endpoint, credential,
tenant and card actually work together. A live test must not mutate money or
silently pass when its environment is absent.

## Decision

Add a manual workflow bound to the protected `commerce-provider-evidence`
Environment. It requires operator-provided non-secret variables, optionally
injects an authorization header from an Environment secret, performs one
bounded read-only observation and reconciles it with a local ledger projection.
The test is skippable in ordinary local package runs when no endpoint is
configured, but the manual workflow preflight fails closed before execution.

## Consequences

- A successful run is evidence of the configured issuer read path and
  merchant/provider balance agreement at that time.
- The card must be pre-created and safe to observe; no provider mutation is
  hidden in the journey.
- Issuer mutation, settlement, IAM, rotation, WORM, backup and recovery
  evidence remain explicit separate obligations.
- Provider error bodies are never included in thrown messages, preventing
  accidental persistence of issuer secrets or tenant data.

## Evidence

`packages/commerce/test/gift-card-provider-live.test.ts` and
`.github/workflows/gift-card-provider-evidence.yml`.
