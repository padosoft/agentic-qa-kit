# ADR-263: Protected mTLS and runner-token rotation evidence

## Decision

Ship a manually triggered workflow that uses an operator-provided client
certificate to reach a protected HTTPS endpoint and then proves old-token
rejection/new-token acceptance against a runner queue probe.

## Rationale

The repository already implements short-lived JWT validation, lease fencing and
projected token-file rereads. Unit tests cannot prove the deployed TLS
terminator, trust root or token revocation behavior. This workflow makes that
external boundary executable while keeping credentials outside Git and logs.

## Boundary

The result is deployment evidence only. It does not claim control over the
IdP, CA lifecycle, secret propagation, revocation latency, availability or
external compliance audits.
