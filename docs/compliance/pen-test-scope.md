# Pen-test scope & cadence

> What an external pen-test team should attack, when, and what's out of
> scope. This document is the contract — vendors must acknowledge it
> before the engagement starts.

## In scope

1. **Server API surface** (`@aqa/server`)
   - Findings ingest endpoint (authentication bypass, IDOR, injection)
   - Run lifecycle endpoints (race conditions on queue lease)
   - Admin-only endpoints (privilege escalation from runner role)
2. **Pack loading path** (`@aqa/pack-loader`, `@aqa/pack-scanner`)
   - Signature bypass (substituted manifest, replay of old signature)
   - Always-on-shell pack acceptance (must be refused)
3. **Sandbox escape** (`@aqa/sandbox`)
   - Container escape via probe code
   - Side-channel between probes in the same pool
4. **Audit log tamper** (`@aqa/compliance`)
   - Confirm `aqa-audit-verify` detects any modification

## Out of scope

- Underlying Kubernetes / cloud provider (customer infrastructure).
- LLM provider endpoints (`@aqa/llm-adapters` adapters call out to
  vendor APIs — those are the vendors' attack surface).
- DoS attacks above the documented rate limits (we publish the rate
  limit; testing above it is testing the cloud LB, not AQA).
- Social engineering of customer staff.

## Cadence

- **Annual full-scope test** — required for SOC2 Type II.
- **Quarterly diff test** — only the surfaces changed since the last
  full test, scoped from git history.
- **Pre-1.x major-release test** — for any major version bump.

## Reporting

Findings are filed as `@aqa/schemas` `Finding` records with `severity`
and `verification_floor=high` (L3 reproducibility required). The pen
test team is given a runner credential so their findings flow through
the same hash-chained audit pipeline as internal findings.

## Acknowledgement

The pen-test team must sign off on this scope document before the
engagement. The signed copy is itself an audit artifact — store it in
the customer's evidence vault.
