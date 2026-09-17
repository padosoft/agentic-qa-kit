# ADR-057 — CLI performance ingestion uses the shared evidence boundary

## Status

Accepted — 2026-09-17

## Decision

`aqa ingest` accepts `k6` and `locust` alongside JUnit and SAST. JSON is parsed
through `@aqa/ingest`, then written through the existing bounded, redacting
`FileArtifactStore`. The command reports normalized record counts and retains
the same error behavior for malformed input.

## Evidence and limits

The CLI test covers both new frameworks; the workspace gate passes with 506
tests and four environment-skipped PostgreSQL contracts. Threshold-file CLI
options, live load execution and CI release-gate enforcement are not claimed by
this adapter wiring.
