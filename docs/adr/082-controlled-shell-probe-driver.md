# ADR-082 — Controlled shell probe driver

## Status

Accepted — 2026-09-17

## Decision

`@aqa/runner` provides an opt-in `makeShellProbeRunner()` for operational
checks that cannot be expressed over HTTP. It requires `allowShell=true`, an
exact executable allowlist, a caller-supplied working directory, argv arrays
and a bounded timeout/output budget. It invokes `spawn()` with `shell:false`,
passes only an explicit minimal environment, and redacts common credential
patterns before returning stdout/stderr evidence.

## Rationale

Ecommerce and worker journeys need to inspect queues, run safe maintenance
commands and validate CLI contracts. A shell string would create command
injection and ambient-secret risks. Separating executable and arguments keeps
the driver policy-visible and makes capability approval explicit.

## Limits

The driver is not a sandbox. Production must run it inside the OCI/job sandbox,
use a narrow executable wrapper allowlist, a non-privileged identity and a
dedicated working directory. Packs must not gain shell access merely by
declaring `kind: shell`; the host integration must explicitly construct this
runner and pass capability preflight.
