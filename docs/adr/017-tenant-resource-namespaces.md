# ADR-017: Tenant namespaces for configuration resources

- Status: accepted
- Date: 2026-09-17

## Context

The PostgreSQL record table had a global `(kind, record_key)` identity, while
the HTTP API already accepted tenant headers. A filtered list alone could not
protect a same-name resource during load, update or delete. Profiles, risks,
scenarios and packs therefore needed an identity boundary at the storage key.

## Decision

`StoreProvider` resource methods accept an optional `{ org, project }` scope.
When present, new keys use the deterministic form
`@scope/<encoded-org>/<encoded-project>/<resource-key>`. Both MemoryStore and
PostgresStore prefer that scoped key for reads and mutations; scoped listings
return only their namespace plus legacy unscoped records. The API propagates the
request scope to these methods.

Legacy unscoped records remain readable during migration, but are not rewritten
or treated as proof of tenant isolation. A future migration must assign each
legacy record to an explicit project before removing the fallback.

## Consequences

- Same-name resources in two projects no longer overwrite one another.
- The primary key schema remains backward-compatible; no destructive migration
  is required for existing installations.
- Legacy global records remain a documented residual risk until assigned to a
  tenant, so production readiness must include a migration/deny policy.
