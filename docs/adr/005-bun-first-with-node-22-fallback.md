# ADR-005 — Bun-first toolchain with Node 22 LTS as a tier-1 fallback

- **Status:** Accepted
- **Date:** 2026-05-17
- **Tags:** runtime / adoption

## Context

Bun is the most ergonomic runtime for this workload (workspace install,
native TypeScript, native test runner, fast cold starts). Enterprise
security reviews, however, often allow only Node and refuse to certify Bun
quickly enough to ship into a regulated environment.

## Decision

- The default developer toolchain is **Bun ≥ 1.3.0** (pinned in `.bun-version`
  and `packageManager`).
- Every shipped package supports **Node ≥ 22 LTS** as a tier-1 fallback:
  - `pretest` builds via `tsc`; `test` runs via `node --experimental-strip-types
    --test`, so the same test file runs under both runtimes.
  - CI has two parallel test jobs — `Unit tests (Bun)` and
    `Unit tests (Node 22 LTS)` — both gated on every PR.

## Consequences

- Adoption inside organisations stuck on Node is unblocked.
- Maintainer cost stays bounded — there is one source tree; the two runtimes
  exercise the same `dist/`.
- The CLI's `aqa init` writes profiles that work on either runtime.

## Alternatives considered

- **Bun-only.** Rejected: blocks enterprise rollout.
- **Node-only.** Rejected: gives up the developer ergonomics for no
  compensating gain inside this team.
- **Deno.** Out of scope for v0.1; the profiler already detects Deno projects
  but no first-party runtime support is shipped.
