# ADR-095 — Fail-closed HTTP dispatch policy

## Status

Accepted — 2026-09-17

## Decision

The HTTP probe runner normalizes an explicit origin allowlist, rejects
credential-bearing base and request URLs, uses `redirect: manual`, and checks
any `Location` target against the same allowlist. Redirects are never followed
implicitly; off-origin or malformed targets become execution errors. Response
bodies remain bounded and request timeouts remain enforced by an abort signal.

## Rationale

The HTTP driver is a security boundary, not a convenience wrapper around
`fetch`. A redirect or embedded credential can change the destination or leak
secrets while the original URL still appears allowlisted.

## Limits

This does not pin DNS answers or intercept all browser network requests.
Browser contexts require a route-level network policy and production hosts
need egress controls for DNS rebinding and private-network access.
