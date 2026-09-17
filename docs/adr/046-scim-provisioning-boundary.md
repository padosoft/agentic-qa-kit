# ADR-046: Tenant-bound SCIM provisioning boundary

## Status

Accepted — protocol boundary shipped; durable/API integration remains open.

## Decision

`@aqa/auth` exposes `ScimProvisioner` over an injected `ScimDirectory` and a
required tenant. It validates SCIM user identity, maps only supported AQA roles,
defaults missing roles to `viewer`, supports safe replacement and bounded patch
operations, and rejects resources not owned by the tenant.

The HTTP bearer-token route and PostgreSQL adapter are intentionally separate
follow-up work because the current user directory store is not tenant-scoped.

## Consequences

SCIM semantics can be tested and reused without coupling protocol code to a
storage implementation. No endpoint may be exposed as production-ready until
token authentication, audit events, tenant-aware persistence and replay/idempotency
behavior are proven together.
