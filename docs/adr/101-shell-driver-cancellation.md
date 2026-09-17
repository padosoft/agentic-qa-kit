# ADR-101: cooperative cancellation for the controlled shell driver

- Status: Accepted
- Date: 2026-09-17

## Decision

The allowlisted, `shell: false` shell driver consumes the optional runner
`AbortSignal`. It rejects before spawning when already aborted, kills the child
when cancellation arrives, removes the listener on `error`/`close`, and returns a
bounded cancellation execution error. `runScenario` therefore does not treat an
interrupted shell process as an oracle failure or emit a finding.

## Limits

`child.kill()` is a cooperative driver boundary, not a complete process-tree or
container isolation guarantee. Descendant cleanup, CPU/memory limits, filesystem
policy and egress policy remain sandbox/deployment responsibilities.

## Verification

`bun run --cwd packages/runner build` and `bun test packages/runner/test/run.test.ts`
pass with **20 tests and 0 failures** locally.
