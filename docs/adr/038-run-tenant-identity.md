# ADR-038: Persist organization identity on runs

## Status

Accepted

## Decision

`Run.org` is an optional schema field for backward-compatible artifact reads,
but every scoped server-created run must carry the authenticated organization.
Store list operations accept an org filter, and scoped run, finding and
coverage API paths require both `run.org === requestedOrg` and
`run.project === requestedProject`.

Runs without an org remain available only to explicitly unscoped/local
operations and are not treated as belonging to every organization.

## Consequences

Organizations may safely reuse project slugs without cross-tenant reads. Queue
workers must copy the authenticated job scope when persisting a Run; migration
of historical unscoped artifacts is a privileged operational task.
