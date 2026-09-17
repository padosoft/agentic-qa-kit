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
