# ADR-191: Independent verification of agent trajectory evidence

## Context

Recording a trajectory is not enough: a host, artifact store or replay tool
must be able to detect altered step ordering, digests, token totals or agent
identity before treating it as evaluation evidence.

## Decision

`@aqa/runner` exposes `verifyAgentTrajectory(snapshot, events?)`. It verifies
schema version and identity, contiguous sequence numbers, SHA-256 digest shape,
non-negative token usage and exact total reconciliation. When the corresponding
hash-chain events are supplied, it also matches count, kind, agent identity,
operation, status, sequence and content digests for every step.

The verifier never reconstructs or requires raw prompt, completion or tool
payloads.

## Consequences

Offline replay and release evaluation can fail closed on tampered or incomplete
trajectory evidence while preserving privacy. Signature/remote attestation,
durable storage integrity and semantic grading remain additional layers.
