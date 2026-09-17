# ADR-014 — OIDC session boundary for the bundled admin

## Status

Accepted for the single-process admin deployment. A shared durable session backend is required before running multiple replicas behind a load balancer.

## Decision

`@aqa/auth` owns the provider-neutral `OidcSessionManager`: it generates one-time state and S256 PKCE verifier/challenge pairs, exchanges the callback exactly once, stores a short-lived process-local session, and resolves an authenticated user from an HttpOnly cookie. `aqa admin` exposes `/auth/login`, `/auth/callback` and `POST /auth/logout` when the manager is configured. OIDC mode never falls back to the local admin identity.

Loopback HTTP defaults to a non-`Secure` cookie so local development works. Non-loopback hosts default to `Secure`; operators terminating TLS upstream can override the setting explicitly.

## Consequences

- Multi-replica production must replace the process-local session map with a shared encrypted/rotated session store.
- OIDC role claims are still constrained to the four AQA roles; unsupported or missing roles fail closed.
- CSRF state is server-side and single-use; reverse proxies must preserve the callback URL and TLS cookie policy.
