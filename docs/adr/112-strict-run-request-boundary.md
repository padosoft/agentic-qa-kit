# ADR-112: strict run request boundary

- Status: Accepted
- Date: 2026-09-17

## Decision

Introduce the shared `RunRequest` schema for `POST /api/runs`. It is a strict
object containing only an optional profile slug and a bounded deterministic
seed. The API validates it before enqueueing and injects `org`/`project` from
the authenticated tenant scope. The worker continues to use its configured
project root and does not accept a client-supplied root or execution control.

## Consequences

- Queue records have a deliberately small, reviewable attack surface.
- Adding a run capability requires an explicit schema/API/worker decision,
  rather than silently forwarding arbitrary JSON.
- Existing clients that send only `profile` remain compatible; unknown fields
  now receive a bounded 400 response.

## Verification

Schemas/server build and **123 server tests** pass locally, including the
unsafe-field rejection journey.
