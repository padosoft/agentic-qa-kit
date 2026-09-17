# ADR-089 — Optional Playwright runtime loading

## Status

Accepted — 2026-09-17

## Context

The controlled Playwright driver is an optional capability. A static import
caused the kit CLI bundle to resolve Playwright's browser transport internals,
including `chromium-bidi`, during an HTTP-only build. This made the hosted
typecheck/lint job fail before any scenario ran.

## Decision

Load the default Playwright `chromium` factory through a runtime dynamic import
only when `makePlaywrightProbeRunner()` is created without an injected factory.
Keep the `playwright` package in the runner's runtime dependencies and expose
the factory boundary for deterministic tests and controlled hosts.

## Consequences

HTTP, API and CLI-only installations no longer need Playwright internals in
their bundle. A host that selects a browser journey must install Playwright
and its trusted browser runtime; a missing installation fails explicitly at
driver creation. Live Chromium, sandbox and provider journeys remain
deployment evidence rather than local unit-test claims.
