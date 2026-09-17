# ADR-085 — Controlled Playwright probe driver

## Status

Accepted — 2026-09-17

## Decision

`@aqa/runner` provides a real Playwright-backed `makePlaywrightProbeRunner()`.
It keeps a browser context across probes, scopes navigation to an explicit
origin allowlist, supports only structured `goto`, `click`, `fill`, `press` and
`wait_for` actions, bounds captured body text, redacts common PII and exposes
an explicit `close()` lifecycle method. Arbitrary JavaScript evaluation and
unrestricted navigation are not part of the probe contract.

## Rationale

Checkout, login, payment challenge and accessibility journeys require browser
state that HTTP probes cannot observe. The browser must remain deterministic
and policy-controlled: an agent-produced action is input data, not permission
to navigate or execute code anywhere.

## Limits

The driver needs an installed, trusted Chromium runtime and host-level sandbox
policy. It does not prove an ecommerce provider effect by itself; browser
evidence must be reconciled with authoritative API/database/provider observers.
The kit integration must close the runner after each run and provide live CI
Chromium evidence.
