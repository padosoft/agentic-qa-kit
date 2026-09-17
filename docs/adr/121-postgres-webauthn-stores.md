# ADR-121: durable WebAuthn challenge and credential stores

## Status

Accepted

## Context

The in-memory WebAuthn lifecycle is not safe for an admin service with more
than one replica: a challenge consumed by one process may be replayed through
another, and concurrent authenticator counters can overwrite each other.

## Decision

Add PostgreSQL stores behind the existing provider-neutral interfaces. Schema
creation is protected by a transaction advisory lock. Challenge verification
consumes the row with `DELETE ... RETURNING`, so only one replica can consume a
challenge. Credential reads require the exact user and credential pair.
Counter-supported credentials update with a conditional `UPDATE` requiring a
strictly larger counter; the affected-row count is the authorization result.
Counterless credentials retain the challenge/signature protections without
pretending a counter exists.

Credential registration is exposed as an explicit store operation but remains
outside the assertion verifier; a production ceremony must validate the
credential and public key before persistence.

## Consequences

The lifecycle can share replay and counter state across replicas. CI with a
real PostgreSQL DSN must execute the concurrent contract; local tests without
that DSN are not durable-storage evidence.
