# ADR-196: PostgreSQL-backed immutable agent trajectories

## Context

The local trajectory store protects replay artifacts on one filesystem, but a
worker fleet needs one authoritative cross-replica identity and durable read
path. Replacing a trajectory for the same run/scenario would invalidate audit
and replay semantics.

## Decision

`@aqa/runner` provides `PostgresAgentTrajectoryStore`. It creates a table with
`(run_id, scenario_id)` as the primary key, inserts with `ON CONFLICT DO
NOTHING`, and compares the existing SHA-256 digest on retries. The JSON
envelope and trajectory invariants are validated before write and after read;
identity segments and serialized size remain bounded. A client can be
injected for hosts that already own the PostgreSQL pool.

## Consequences

Worker replicas can share immutable trajectory evidence and safely retry a
write. PostgreSQL backups, encryption, access policy, PITR and cross-region
restore are still deployment responsibilities; the class does not claim WORM
retention or backup evidence by itself.
