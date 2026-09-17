# ADR-036: Tenant-scoped risk coverage projection

## Status

Accepted

## Decision

Expose `GET /api/risk-coverage` behind `risk-map:read` and mandatory org/project
scope. The route loads risks and scenarios through `StoreProvider`, derives
scenario run observations only from complete `oracle_evaluated` event groups,
and delegates scoring to `@aqa/methodology`.

Incomplete event groups are not interpreted as passes. Replay coverage is true
only when a persisted `replay_finished` event explicitly says deterministic.

## Consequences

Admin and other clients receive the same evidence-derived score as the pure
methodology layer, with tenant isolation enforced at the read boundary. A
future warehouse projection may optimize aggregation, but must preserve this
contract and event completeness semantics.
