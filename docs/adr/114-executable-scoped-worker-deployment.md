# ADR-114: executable scoped worker deployment

- Status: Accepted
- Date: 2026-09-17

## Decision

Ship `aqa worker` in the kit. It reads a Secret-backed `AQA_QUEUE_DSN`, an
operator-owned `AQA_RUNNER_ROOT`, bounded polling configuration and explicit
`AQA_RUNNER_SCOPES`, then composes `PostgresRunnerQueue` with `makeKitWorker`.
The process stops on SIGTERM/SIGINT and closes the database client. Helm's
runner StatefulSet invokes this entrypoint only when `runner.worker.enabled`
is true and fails template rendering when its DSN source or scopes are absent.

## Consequences

- The deployment contract now points at executable behavior rather than a
  placeholder runner container.
- The default chart remains safe for development; production values must opt in
  with explicit scopes and a Secret-backed DSN.
- Live PostgreSQL, image provenance and cluster termination evidence remain
  required before production sign-off.

## Verification

Server and kit builds pass; worker configuration tests pass **3/3**. Helm
validation is CI-authoritative because Helm is not installed locally.
