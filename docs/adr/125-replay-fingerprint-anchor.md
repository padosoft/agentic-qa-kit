# ADR-125: replay identity is anchored to the original failure

## Status

Accepted

## Context

A scenario can emit different failing oracle results on different attempts.
Counting any finding as a replay success can therefore certify a different bug
than the one originally reported. This is especially unsafe for stateful
commerce and authorization journeys where several failures may be plausible.

## Decision

`verifyScenario()` uses the persisted `expected_fingerprint` as the target
identity whenever supplied. Every attempt must emit the same failure
fingerprint; otherwise it is not a success. Without a persisted fingerprint,
the first observed fingerprint remains a best-effort target and the result is
not stronger than the evidence available at discovery time.

## Consequences

Replay callers must persist and pass the original fingerprint to claim
deterministic reproduction. The current fingerprint is based on scenario ID,
failed oracle IDs and reasons; a future replay capsule should add state
snapshots, environment digests and side-effect identity. An attempt with no
finding or an unsupported/error execution never counts as a reproduction.
