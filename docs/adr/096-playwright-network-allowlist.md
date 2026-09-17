# ADR-096 — Playwright context network allowlist

## Status

Accepted — 2026-09-17

## Decision

The controlled Playwright driver installs a `BrowserContext` route handler
before creating pages. Each request must use HTTP(S), contain no credentials
and target an explicitly allowlisted origin; otherwise it is aborted. The
same rule therefore applies to redirects, subresources and requests caused by
structured actions.

## Rationale

Navigation input validation cannot observe browser follow-up requests. A
trusted initial URL can redirect to an untrusted origin or load a sensitive
resource from one. The context boundary is the earliest common enforcement
point.

## Limits

DNS pinning/rebinding and host-level egress controls remain deployment
responsibilities. A real Chromium journey must verify the route behavior on
the supported Playwright version.
