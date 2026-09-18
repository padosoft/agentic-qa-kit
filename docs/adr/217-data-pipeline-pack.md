# ADR-217: Ship an opt-in data pipeline safety pack

## Status

Accepted — 2026-09-18

## Decision

Ship `pack-data-pipeline` with contracts for schema compatibility, data quality
promotion gates and bounded idempotent replay.

## Boundary

The pack does not implement an orchestrator, warehouse, schema registry or
stream broker. Provider-backed lineage, access control, retention, recovery and
exactly-once claims require separate integration evidence.
