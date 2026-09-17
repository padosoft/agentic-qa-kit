# ADR-034: Bounded external result ingestion

## Status

Accepted

## Decision

Add `@aqa/ingest` as a parser/normalization boundary for JUnit XML and
Semgrep-compatible SAST JSON. Every record receives a stable fingerprint and
the CLI persists reports through the redaction-aware artifact store.

The JUnit parser caps input at 10 MiB and rejects `DOCTYPE` and `ENTITY`
declarations. Malformed or ambiguous records fail closed. Ingestion never
changes finding status, because external output alone does not establish AQA
replay or release-gate evidence.

## Consequences

Jest/Vitest/Pytest and Semgrep results can enter the same evidence pipeline
without replacing their native runners. Playwright traces, k6 summaries,
mutation reports and policy-controlled finding linkage require later adapters.
