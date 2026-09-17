# ADR-094 — Pack risk catalog path containment

## Status

Accepted — 2026-09-17

## Decision

Pack-declared risk catalog paths must be relative, exist, remain inside the
pack root after `realpath` resolution and parse as a valid `RiskMap`. A
symlink escaping the pack root is a coverage/supply-chain error and is never
parsed or executed.

## Rationale

Risk catalogs influence finding severity and coverage claims, so they are part
of the executable evidence boundary. Textual path normalization alone does
not protect against symlink indirection.
