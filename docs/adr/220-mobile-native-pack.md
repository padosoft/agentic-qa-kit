# ADR-220: Ship an opt-in mobile-native safety pack

## Status

Accepted — 2026-09-18

## Decision

Ship `pack-mobile-native` with contracts for offline idempotency, minimal
permissions and authenticated single-use deep links.

## Boundary

The pack does not replace device-farm, OS lifecycle, app-store, push-provider
or platform security evidence.
