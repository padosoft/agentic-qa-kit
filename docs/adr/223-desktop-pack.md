# ADR-223: Ship an opt-in desktop safety pack

## Status

Accepted — 2026-09-18

## Decision

Ship `pack-desktop` with contracts for least-privilege IPC, signed rollback-safe
updates and authenticated custom-protocol actions.

## Boundary

The pack does not replace OS packaging, code-signing, native dependency or
platform sandbox evidence.
