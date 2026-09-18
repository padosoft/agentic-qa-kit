# ADR-251: Explicit CLI probe-driver composition

## Status

Accepted — 2026-09-18

## Context

The runner package already implemented HTTP, SQL/PostgreSQL, Playwright and
controlled shell drivers, but the default `aqa run` path only composed HTTP and
the hardened sandbox shell boundary. Packs could therefore declare supported
probe kinds that were present in the library but not executable through the
real CLI journey.

Implicitly enabling SQL credentials, a browser, or host process execution from
pack content would create an unsafe and non-auditable trust expansion.

## Decision

`runRun` accepts an explicit host-owned `probeDrivers` object and composes one
driver per probe kind. It derives a capability set for runner preflight, keeps
the release/security shell path sandboxed, and closes lifecycle-aware drivers
after the run. The CLI maps only explicit operator environment variables to
this object; it never reads credentials or execution policy from a pack.

The PostgreSQL driver remains read-only and bounded, Playwright remains
origin-allowlisted, and shell uses `spawn(..., { shell: false })` plus an exact
executable allowlist. Absolute executable comparisons normalize host path
separators without weakening basename-vs-path policy.

## Consequences

- Real CLI journeys can execute SQL, browser and shell scenarios when an
  operator has intentionally configured them.
- The default remains fail-closed and HTTP-only, preserving least privilege.
- Provider-specific `llm_eval`, `fs` and `custom` execution remains an explicit
  embedding boundary rather than pretending to be implemented.
- The environment names and operational guardrails are documented in the pack
  authoring guide.
