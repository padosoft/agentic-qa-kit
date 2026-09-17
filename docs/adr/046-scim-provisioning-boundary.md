# ADR-046: Tenant-bound SCIM provisioning boundary

## Status

Accepted — tenant-aware persistence, HTTP boundary and basic filter/pagination shipped; advanced protocol operations remain open.

## Decision

`@aqa/auth` exposes `ScimProvisioner` over an injected `ScimDirectory` and a
required tenant. It validates SCIM user identity, maps only supported AQA roles,
defaults missing roles to `viewer`, supports safe replacement and bounded patch
operations, and rejects resources not owned by the tenant.

HTTP `/scim/v2/Users` routes now require an injected dedicated bearer verifier
and `x-aqa-org`. The StoreProvider directory contract is tenant-aware and uses
the existing scoped namespace; legacy unscoped user records remain explicit
migration/admin data.

## Consequences

SCIM semantics can be tested and reused without coupling protocol code to a
storage implementation. The current boundary proves auth, scope, lifecycle and
basic list semantics, while token rotation, audit emission, full RFC filter
grammar and live PostgreSQL journey evidence remain required for full production
signoff.
