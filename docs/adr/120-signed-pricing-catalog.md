# ADR-120: signed pricing catalog provenance

## Status

Accepted

## Context

Token counts and a local SHA-256 digest make cost records reproducible, but a
modified catalog can still be self-consistently hashed and used to admit or
price LLM calls. Budget enforcement needs an operator trust boundary separate
from the catalog data itself.

## Decision

`@aqa/cost` supports Ed25519 signatures over the canonical catalog bytes. A
signed catalog carries an explicit algorithm and `key_id`; verification accepts
only a trusted public key supplied out of band and rejects unknown keys,
algorithm changes, malformed signatures and modified catalog content. The
existing digest/version/effective timestamp remain part of the signed
canonical representation and continue to be persisted with usage evidence.

Private keys never enter the catalog or logs. Key distribution and rotation are
operator responsibilities; the cost package does not invent a KMS or trust
remote pricing URLs.

## Consequences

Budget admission can be tied to an approved pricing identity rather than an
untrusted local file. A valid signature still does not prove vendor invoice
reconciliation; actual provider usage and billing reconciliation remain a
separate production control.
