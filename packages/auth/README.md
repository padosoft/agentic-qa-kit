# @aqa/auth

User/Role/Permission shapes and a provider-neutral OIDC Authorization Code + PKCE adapter.

- `User`, `Role`, `Permission`, `AuthSession` validated via Zod.
- `rolePermissions` declares the default matrix (viewer/developer/maintainer/admin).
- `allows(user, permission)` answers per-permission authorization.
- `OidcAdapter` performs discovery, Authorization Code + PKCE exchange, UserInfo
  retrieval and strict AQA role mapping. Missing claims, endpoints or secrets fail closed.

The application remains responsible for generating/storing the CSRF `state`,
binding it to the browser session, and generating a S256 PKCE verifier/challenge.
The adapter never logs client secrets or bearer tokens and never grants an
implicit admin role.
