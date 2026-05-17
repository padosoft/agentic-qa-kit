# @aqa/auth

User/Role/Permission shapes and an OIDC adapter scaffold.

- `User`, `Role`, `Permission`, `AuthSession` validated via Zod.
- `rolePermissions` declares the default matrix (viewer/developer/maintainer/admin).
- `allows(user, permission)` answers per-permission authorization.
- `OidcAdapter` is a v0.3 scaffold; the Authorization Code + PKCE flow ships
  with the server extraction (Task 19).
