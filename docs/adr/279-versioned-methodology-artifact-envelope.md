# ADR-279: Versioned methodology artifact envelope

## Status

Accepted — provider-neutral serialization contract shipped; durable adapter and admin visualization remain open.

## Decision

Methodology artifacts are serialized as bounded, versioned envelopes containing
the artifact kind, stable identity, positive revision, canonical UTC creation
time, payload, and SHA-256 payload digest. Parsing canonicalizes and validates
the payload again, validates attack trees before persistence, and rejects schema
or digest drift. The envelope is deliberately independent of Postgres, S3 and
the admin UI so every adapter can share the same integrity contract.

## Consequences

An adapter can safely reload an approved artifact and prove that its payload has
not changed since publication. This does not itself provide durable storage,
tenant authorization, migrations, retention, or UI editing; those remain the
next persistence/productization slices.
