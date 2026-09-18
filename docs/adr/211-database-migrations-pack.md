# ADR-211: Ship an opt-in database migration safety pack

## Status

Accepted — 2026-09-18

## Decision

Ship `pack-database-migrations` as a provider-neutral, opt-in pack with
schema-valid scenarios for expand/contract compatibility, rolling deploys and
rollback/backfill reconciliation.

## Boundary

The pack supplies executable contracts and explicit evidence requirements. It
does not implement migrations, create backups, perform PITR, or claim that a
passing placeholder endpoint proves production safety. Operators must bind the
scenarios to a disposable environment and review destructive-operation controls.
