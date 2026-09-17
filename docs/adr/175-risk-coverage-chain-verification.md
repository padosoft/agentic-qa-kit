# ADR-175: Verify audit chains before measuring coverage

## Context

Risk coverage is a release gate. Schema-valid `scenario_finished` events are
not sufficient evidence because an edited event can still describe a passing
scenario while retaining valid JSON and a valid event shape.

## Decision

`aqa risk coverage` now verifies every persisted `events.jsonl` hash chain
before it contributes observations to the methodology calculator. A malformed
event or chain produces `ok=false` and no coverage reports; it can never be
interpreted as stale or passing evidence.

## Boundary

This validates the local hash-chain contract. Independent checkpoint/WORM
publication, remote artifact immutability and provider-level ecommerce
semantics remain separate production evidence.
