# @aqa/auth

User/Role/Permission shapes and a provider-neutral OIDC Authorization Code + PKCE adapter.

- `User`, `Role`, `Permission`, `AuthSession` validated via Zod.
- `rolePermissions` declares the default matrix (viewer/developer/maintainer/admin).
- `allows(user, permission)` answers per-permission authorization.
- `OidcAdapter` performs discovery, Authorization Code + PKCE exchange, UserInfo
  retrieval and strict AQA role mapping. Missing claims, endpoints or secrets fail closed.

`OidcSessionManager` supplies a one-time PKCE binding and HttpOnly
session-cookie boundary. It accepts an `OidcSessionStore` backend for shared
multi-replica state; `PostgresOidcSessionStore` provides atomic PKCE consumption
and durable sessions. Synchronous authentication fails closed when an async
backend is configured, so callers must use `authenticateAsync`. The adapter
never logs client secrets or bearer tokens and never grants an implicit admin
role.

`RunnerJwtAuthorizer` verifies dedicated runner credentials using an explicit
RS256 trust root, issuer, audience, bounded clock skew, expiry/not-before and
tenant/project scopes. It rejects unsigned or algorithm-switched tokens and
does not infer a wildcard from malformed scope text. `aqa admin` can wire it
from `AQA_RUNNER_JWT_PUBLIC_KEY`, `AQA_RUNNER_JWT_ISSUER` and
`AQA_RUNNER_JWT_AUDIENCE`; all three must be present together. Static
`AQA_RUNNER_TOKEN` remains only as an explicit bootstrap compatibility path.

`WebAuthnLifecycle` supplies the server-side challenge/assertion boundary for
passkeys. Challenges are random, short-lived and single-use; assertions are
bound to the authenticated user, HTTPS origin, RP ID and registered credential.
Signature verification is injected so deployments can select a maintained
WebAuthn implementation, while credential counters detect cloning when the
authenticator supports them. Counterless authenticators are supported with the
same one-time challenge protection. The package does not claim to be a browser
ceremony or a cryptographic provider by itself; production must connect the
boundary to a standards-compliant verifier and durable stores.

`PostgresWebAuthnChallengeStore` and `PostgresWebAuthnCredentialStore` provide
the multi-replica persistence boundary. Challenge consumption is an atomic
delete, and supported-authenticator counters update only when the stored value
is lower than the assertion value. Registration remains an application/IdP
ceremony concern; the stores never accept private keys.
