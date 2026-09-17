# ADR-186: Inject HTTP probe secrets only from the run host

## Context

The HTTP driver correctly rejects an authenticated probe when its secret is
missing, but `aqa run` also needs an explicit production path to provide that
secret. Pack files and CLI arguments are not acceptable secret stores.

## Decision

`RunOptions.httpSecrets` is the programmatic injection boundary. The CLI also
maps `AQA_HTTP_SECRET_<NAME>` environment variables to named references such
as `auth: "${OLD_TOKEN}"`; values remain in process memory and are never
written to events, findings or diagnostics. Explicit `httpSecrets` entries
override environment entries with the same name.

## Consequences

Authenticated packs can execute through the real `aqa run` HTTP boundary while
keeping credentials outside pack content. Operators must source the variables
from a secret manager/CI secret store and must rotate them there. Token
rotation semantics and provider-specific login flows remain separate journey
evidence.
