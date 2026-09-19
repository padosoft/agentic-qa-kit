# ADR-278: Methodology proposal approval governance

## Status

Accepted — repository contract shipped; durable persistence and identity-provider
evidence remain deployment concerns.

## Decision

Methodology artifacts generated or edited by an agent are represented by a
bounded proposal containing a canonical SHA-256 digest, artifact identity and
monotonic revision. An independent human approval must bind to the same
proposal, digest and revision before the artifact can be considered approved.
Approval expiry is checked at use time. Artifact contents are not copied into
the approval record, preventing secrets or large payloads from leaking into
governance metadata.

## Consequences

The local contract prevents stale, tampered or self-approved methodology from
silently becoming release evidence. A host may persist proposals and approvals
in its store and map `approved_by` to an authenticated principal later; this
ADR does not pretend that an in-memory contract is an identity-provider or
compliance attestation.
