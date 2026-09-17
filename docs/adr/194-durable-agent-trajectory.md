# ADR-194: Durable immutable agent trajectory artifacts

## Context

An in-memory trajectory can disappear on worker restart and a plain JSON file
can be replaced after it has been used for replay. A hash in the event stream
does not itself provide durable artifact retention.

## Decision

`@aqa/runner` provides `AgentTrajectoryStore`. It validates a snapshot before
writing, stores a versioned envelope with the snapshot digest, bounds its UTF-8
size, uses a temporary file plus rename, and refuses a different replacement
for an existing `(run_id, scenario_id)` artifact. Reads recompute the digest
and rerun trajectory validation before returning data. Run and scenario names
are restricted to safe lowercase path segments.

The root is a host-controlled storage boundary: operators may mount it on
WORM/Object-Lock or replace it with an S3-compatible implementation. The local
store does not claim remote durability or legal retention by itself.

## Consequences

Replay consumers can detect tampering and malformed artifacts before use, and
worker restarts no longer imply loss when the host persists the root. Remote
retention, backup/restore drills and object-lock evidence remain deployment
responsibilities.
