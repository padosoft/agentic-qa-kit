# ADR-059 — CI fixture journey for performance threshold gates

## Status

Accepted — 2026-09-17

## Decision

The CI CLI smoke job runs a small non-secret k6 summary through the built CJS
bundle with a deliberately failing p95 policy. It asserts exit code `2` and
the persisted threshold artifact. The fixture validates CLI wiring and
evidence preservation; it is not a substitute for live load generation.

## Rationale

The threshold contract must be exercised in the same published artifact path
used by automation. Keeping the fixture deterministic avoids network, credentials
and flaky load conditions in the base CI gate while making the remaining live
performance environment gap explicit.

## Evidence and limits

The workflow step is present and local build/lint/diff checks pass. Hosted GitHub
Actions execution and a real k6/Locust run against a representative SUT remain
required before performance SLO claims.
