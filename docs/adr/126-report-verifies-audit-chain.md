# ADR-126: Verify the audit chain before rendering reports

**Status:** Accepted  
**Date:** 2026-09-17

## Context

`aqa report` reconstructs run state from `events.jsonl`. Previously it parsed
the events and trusted their fields without re-computing the hash chain. A
locally modified event could therefore be rendered as authoritative even
though the compliance verifier would reject it.

## Decision

`aqa report` calls `@aqa/compliance.verifyEventChain` immediately after
parsing `events.jsonl` and fails closed before reading findings or writing
`report.md`/`report.json`. The report test fixtures now use the same canonical
SHA-256 sealing algorithm as the production writer, and a tamper regression
proves that payload changes are rejected.

## Consequences

- Report output is protected against accidental or local payload tampering.
- Report generation and the standalone audit verifier share the same integrity
  contract.
- This does not prove completeness, authorship, or immutability: an attacker
  able to rewrite the complete file can re-seal it, and independent checkpoint
  storage/WORM controls remain required for production audit claims.
