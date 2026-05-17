# ADR-003 — Hash-chained `events.jsonl`

- **Status:** Accepted
- **Date:** 2026-05-17
- **Tags:** compliance / audit

## Context

SOC2 / ISO 27001 controls require that "audit logs are protected against
unauthorised modification". A plain append-only JSONL file fails the test —
anyone with write access can rewrite history.

## Decision

Every entry in `.aqa/runs/<id>/events.jsonl` carries:

- `seq` — strictly increasing integer.
- `prev_hash` — the previous entry's `hash`, or `null` for `seq=0`.
- `hash = sha256(prev_hash ‖ canonical(rest_of_event))`.

Canonicalisation sorts object keys alphabetically so the hash is stable across
re-emissions. The first event uses a fixed zero seed (`'0' * 64`).

Validation: the runner verifies the chain end-to-end on read; an explicit test
in `@aqa/runner` re-hashes every event and asserts equality.

## Consequences

- Any tampering with a past event breaks every subsequent hash; detection is
  trivial.
- The admin panel's Audit screen renders a verified/broken badge per run.
- No external database needed for tamper-evidence — the JSONL itself proves it.

## Alternatives considered

- **Sign every line with a private key.** Rejected for v0.1: requires key
  management. May be added in v0.3 alongside SSO/OIDC.
- **External transparency log.** Rejected for v0.1: dependency overhead too
  high for a self-hosted-first product.
