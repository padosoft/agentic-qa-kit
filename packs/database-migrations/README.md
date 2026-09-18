# Database migrations pack

This is an opt-in, provider-neutral baseline for teams that need evidence around
expand/contract migrations, rolling deploy compatibility and rollback safety.

It assumes disposable migration environments expose the placeholder endpoints
used by the scenarios, or that operators adapt the scenarios to their migration
runner. It is not a migration engine and does not prove that a production
database was backed up, restored, replicated, locked, or actually migrated.

Enable it explicitly with the `database-migrations`, `database`, or `migration`
project tag. Run it only against non-production data until the endpoints,
credentials, destructive-operation policy and rollback evidence have been
reviewed by the service owner.
