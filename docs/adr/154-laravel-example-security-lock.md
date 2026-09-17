# ADR-154 — Lock and upgrade the Laravel example dependencies

## Status

Accepted — 2026-09-17

## Context

GitHub Dependabot reported high and moderate advisories for the example's
unlocked Laravel 11 requirement. An example is still copied into real
projects, so an unpinned vulnerable dependency graph is a supply-chain defect,
even though it is not part of the published TypeScript runtime.

## Decision

Move the example to Laravel 12.69.2, add the generated `composer.lock`, and
require consumers to install the reviewed graph. Composer's security policy
reports no advisories for the locked graph; no advisory was ignored or
disabled.

## Consequences

The example's PHP/Laravel baseline advances and the lockfile is updated by
Composer rather than hand-edited. Future dependency changes must run
`composer validate --strict` and `composer audit --locked`.
