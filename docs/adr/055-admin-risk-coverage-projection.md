# ADR-055 — Admin risk coverage projection

## Status

Accepted — 2026-09-17

## Decision

Expose the existing `/api/risk-coverage` measurement as a first-class admin
screen. The screen keeps the methodology statuses (`covered`, `partial`,
`gap`, `stale`), shows the underlying denominators and replay/pass-rate
measurements, and surfaces drift alerts. Mock mode uses clearly labelled
fixtures; live mode fetches the server projection and does not silently fall
back to fixtures after an error.

## Rationale

Risk-map declarations without an operator-facing coverage projection make it
too easy to confuse “a risk exists” with “the risk is continuously tested”.
The UI therefore links back to the risk editor while retaining the API as the
source of truth for tenant-scoped evidence and status calculation.

## Evidence and limits

The admin typecheck and focused Playwright navigation/table journey pass. A
live authenticated browser journey against a deployed server and identity
provider remains an environment gate.
