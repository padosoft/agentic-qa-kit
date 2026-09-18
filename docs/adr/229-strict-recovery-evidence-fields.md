# ADR-229: Reject unsupported fields in recovery evidence

## Status

Accepted — 2026-09-18

## Context

The backup inventory, restore-drill record and signed production-evidence
contracts canonicalize known fields before hashing or signing. If the parser
silently ignored an unknown property, a caller could attach operational claims
that were neither validated nor covered by the signature. That creates an
audit ambiguity and makes downstream consumers disagree about the meaning of
the same evidence document.

## Decision

All recovery evidence objects are strict at every level. Backup inventories,
restore drills, production evidence, signed envelopes and signature objects
reject unsupported fields before validation, canonicalization or signature
verification. New fields require an explicit schema/ADR change rather than
being silently accepted.

## Consequences and boundary

This is a fail-closed parsing boundary and prevents unsigned metadata from
being presented alongside a valid evidence record. It does not prove that the
underlying provider observation happened: PostgreSQL PITR, object-store
restore, KMS, WORM and identity evidence still require a real deployment drill.
