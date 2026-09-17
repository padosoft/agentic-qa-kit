# ADR-024 — Publish byte-preserved canonical run evidence

## Status

Accepted — 2026-09-17

## Context

`aqa run` writes a hash-chained `events.jsonl` and a redacted
`findings.jsonl` locally, while replay artifacts use the configured local or
S3-compatible artifact store. Leaving the canonical streams outside that
store creates an incomplete retention and recovery boundary.

## Decision

After `run_finished` is appended, publish both canonical streams as
`canonical/events.jsonl` and `canonical/findings.jsonl` through the selected
`ArtifactStore`, followed by `canonical/manifest.json` containing their
content digests, byte counts and keys. Canonical streams use `putBytes`, not
`putText`, so adapter redaction cannot alter already-redacted audit bytes or
invalidate the event-chain digest. Any publication failure makes the run
`ok: false` and remains visible in the structured error.

## Consequences

Local runs have verifiable metadata sidecars and S3 runs have a durable
canonical evidence boundary with the same digest contract. Publication is
not a distributed transaction: a partial upload can remain and operators
must retry or clean it according to their retention policy. Object Lock,
versioning, KMS and tenant-derived prefixes remain deployment controls.
