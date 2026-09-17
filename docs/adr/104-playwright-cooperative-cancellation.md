# ADR-104: cooperative cancellation for Playwright probes

- Status: Accepted
- Date: 2026-09-17

## Decision

The structured Playwright driver consumes the optional worker `AbortSignal`.
Already-aborted probes fail before browser dispatch. While a page is active,
abort closes that page; the driver checks cancellation after browser awaits,
returns an execution error, and removes the listener in `finally`. The shared
browser context remains available for later probes and is still closed by the
runner lifecycle.

## Limits

Page closure is cooperative and does not prove Chromium process cleanup,
provider-native cancellation, or sandbox isolation. Those remain deployment and
browser-runtime controls.

## Verification

Runner build/typecheck and the runner suite pass locally with **21 tests and 0
failures**.
