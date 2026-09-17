# ADR-118: scoped runner JWT authentication

## Status

Accepted

## Context

The runner queue is tenant-scoped, but a boolean callback or shared static
token does not establish runner identity, issuer trust, token lifetime or the
projects a worker may consume. A rogue worker must not claim another tenant's
jobs even when it can reach the queue endpoint.

## Decision

Add `RunnerJwtAuthorizer` to `@aqa/auth` and wire it into `aqa admin` when all
three operator-owned environment values are configured:

- `AQA_RUNNER_JWT_PUBLIC_KEY` — PEM trust root;
- `AQA_RUNNER_JWT_ISSUER` — exact issuer claim;
- `AQA_RUNNER_JWT_AUDIENCE` — exact audience claim.

Only RS256 JWTs are accepted. The verifier requires a valid signature, `sub`,
`iss`, `aud`, `exp`, optional bounded `nbf`, and a non-empty scope claim. Scope
entries are exactly `org/project` or explicit `org/*`; malformed entries fail
closed. The resulting `runner_id` and scopes are passed to the existing queue
boundary, which enforces them during dequeue and ACK/fail handling.

The legacy static bearer token remains available only when explicitly supplied
for bootstrap compatibility. It is not equivalent to the short-lived scoped
JWT path and must not be used as production identity evidence.

## Consequences

The queue now has a concrete, provider-neutral JWT trust boundary without
coupling the repository to one IdP. Key rotation, token issuance, JWKS refresh,
mTLS, revocation and an external identity-provider journey remain deployment
responsibilities. Production must rotate the public trust root safely and prove
the live server-to-worker path with issued tokens.
