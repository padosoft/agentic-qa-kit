# ADR-128: Admin Runs and Findings consume the live API

**Status:** Accepted  
**Date:** 2026-09-17

## Context

The admin dashboard had production-shaped pages backed by static fixtures for
Runs and Findings. That made a browser screenshot look healthy while the
control plane could return different data or no data at all.

## Decision

Runs and Findings fetch the tenant-scoped `/api/runs` and `/api/findings`
endpoints, display an explicit `live API` source marker when the response is
loaded, and use the local preview only when the API is unavailable. The
ecosystem Playwright journey now boots a real SUT, executes a real CLI run,
serves the real API, and asserts live audit, Runs, and Findings pages.

The ecosystem fixture must declare every referenced risk and invariant. Its
setup now creates `risks/live.yaml` instead of relying on an unresolved
scenario reference.

## Consequences

- The list pages no longer silently present fixtures when a live API response
  exists, including a valid empty response.
- The complete journey proves browser-to-API-to-run evidence for these lists.
- Run/finding detail persistence across process restart, real Postgres, and
  tenant switching remain separate acceptance journeys.
