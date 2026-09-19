# ADR-280: Durable tenant-scoped methodology artifact store

## Status

Accepted — MemoryStore and PostgresStore contracts shipped; API authorization,
retention policy, S3 archival and admin UI remain separate layers.

## Decision

`StoreProvider` persists the versioned methodology envelope as an immutable
`artifact_id + revision` record scoped by organization and project. Adapters
revalidate the envelope and its payload digest before writing. A duplicate
revision with the same digest is idempotent; a duplicate revision with another
digest fails closed. PostgreSQL uses `ON CONFLICT DO NOTHING` followed by an
exact digest comparison, so concurrent writers cannot overwrite a revision.

## Consequences

Methodology revisions now survive a Postgres process restart and cannot leak
between tenant scopes through the storage interface. The store intentionally
does not decide who may approve or publish an artifact: that belongs to the
authenticated API/control-plane boundary. Retention, archival and UI remain
deployment/productization work.
