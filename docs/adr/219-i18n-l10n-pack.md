# ADR-219: Ship an opt-in i18n/l10n safety pack

## Status

Accepted — 2026-09-18

## Decision

Ship `pack-i18n-l10n` with contracts for locale coverage, semantic formatting
and safe fallback/direction behavior.

## Boundary

The pack does not provide translations or determine tax/legal correctness.
Human linguistic review, visual/device coverage and regional compliance remain
separate evidence boundaries.
