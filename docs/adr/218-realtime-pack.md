# ADR-218: Ship an opt-in realtime safety pack

## Status

Accepted — 2026-09-18

## Decision

Ship `pack-realtime` with contracts for connection lifecycle, bounded
backpressure and cursor-based replay ordering.

## Boundary

The pack does not implement a broker, WebSocket/SSE client or load generator.
Provider durability, proxy behavior, device lifecycle and capacity evidence
remain separate integration boundaries.
