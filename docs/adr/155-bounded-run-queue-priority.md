# ADR-155 — Bounded persistent run-queue priority

## Status

Accepted — 2026-09-17

## Context

The runner queue was FIFO-only. Release gates and incident probes could not be
admitted ahead of a long exploratory backlog, while an unconstrained priority
field would permit starvation and make capacity behavior unpredictable.

## Decision

Add an optional integer priority from `-10` to `10` to the public run request
and queue job. Higher values are leased first; equal priorities preserve
`enqueued_at`/ID order. PostgreSQL persists the value with an additive,
default-zero migration, and the memory adapter applies the same ordering.

This is scheduling priority, not tenant fairness: fairness, weighted quotas
and starvation budgets remain separate work. The API rejects values outside
the bound before enqueue and idempotency fingerprints include the request
priority.

## Evidence boundary

Memory, API and PostgreSQL contract tests cover validation and ordering. The
PostgreSQL ordering test runs only when `AQA_TEST_POSTGRES_DSN` is supplied;
production fairness and starvation SLOs still require load testing.
