# ADR-072 — Separate execution outcome from oracle assertion

## Status

Accepted — 2026-09-17

## Decision

`@aqa/runner` reports `execution_status` independently from `OracleResult.passed`. A missing probe driver, thrown transport error, failed response capture or cleanup error marks the scenario execution as failed. Findings are emitted only when execution completed and an oracle failed. `aqa run` persists bounded execution-error samples and returns `ok: false` for those gaps.

## Rationale

Treating “no response” as a failed security assertion produces false positives, while treating it as success produces false negatives. The previous behavior could emit a finding from the default no-driver stub and still allow informational profiles to return green. Explicit driver injection keeps fixture tests honest and makes production capability requirements observable.

## Evidence and limits

- Runner and CLI tests prove missing-driver runs fail without findings and valid injected-driver runs retain finding behavior.
- Browser, SQL, shell and agent drivers remain separate capability work; their absence must continue to be reported as an execution gap.
