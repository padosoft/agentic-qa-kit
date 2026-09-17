# ADR-159 — Authenticated API for the durable budget kill-switch

## Status

Accepted — 2026-09-17

## Context

The shared budget ledger can persist an emergency stop, but an operator could
only reach it through an embedded host or a database procedure. That is not a
complete production control plane, and exposing a generic unauthenticated
endpoint would be unsafe.

## Decision

Add tenant-scoped `GET /api/cost/halt` and `POST /api/cost/halt` routes. Reads
require `cost:read`; writes require the new admin-only `cost:edit` permission.
The key is derived from the authenticated `org/project` scope, never accepted
from the request body. POST validates and bounds the reason, returns `202`, and
the underlying ledger remains irreversible. If no durable controller is wired,
both routes return `503` instead of claiming a successful control operation.

`aqa admin` wires `AQA_BUDGET_DSN` to `PostgresBudgetLedger`; the Helm server
deployment maps the configured PostgreSQL secret to that variable.

## Evidence and limits

The server suite now covers scope, validation, success, readback and the
fail-closed unconfigured path. Helm CI asserts the production-shaped budget
DSN mapping. A real operator authentication ceremony and a deployed incident
exercise remain operational evidence.
