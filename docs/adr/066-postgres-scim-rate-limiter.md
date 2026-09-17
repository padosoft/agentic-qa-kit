# ADR-066 — PostgreSQL SCIM rate limiter

## Status

Accepted — 2026-09-17

## Decision

`PostgresScimRateLimiter` implements the SCIM limiter contract with one row per
tenant and a transaction-scoped PostgreSQL advisory lock. It resets expired
windows and increments active windows atomically, returning false at the
configured request budget. The admin boot path selects it when
`scimRateLimitDsn` or `AQA_SCIM_RATE_LIMIT_DSN` is configured; otherwise it
uses the bounded process-local limiter.

## Rationale

SCIM abuse protection must remain correct when two replicas receive requests
for the same tenant concurrently. A read-then-write counter without a shared
lock can admit more than the configured budget. The limiter stores only tenant
window metadata and no bearer secret.

## Evidence and limits

The auth suite includes a cross-instance PostgreSQL contract that runs when
`AQA_TEST_POSTGRES_DSN` is available; locally it is an explicit environment
skip. Helm and CI template assertions verify the DSN wiring. Hosted PostgreSQL
execution and load evidence remain required before declaring HA enforcement
verified.
