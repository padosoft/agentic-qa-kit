# ADR-197: Executable scenario preconditions

## Status

Accepted

## Context

Scenario `preconditions` were historically an array of strings. They conveyed
intent to a human or agent but did not run any setup assertion. A scenario could
therefore execute state-changing probes against an unprepared SUT and produce
misleading findings.

## Decision

Keep string entries as backwards-compatible descriptive context and add a
structured form:

```yaml
preconditions:
  - id: health-ready
    probe:
      id: check-health
      kind: http
      with: { url: /healthz }
    oracle:
      id: health-200
      kind: http_status
      probe_id: check-health
      with: { expected: 200 }
```

The runner executes structured preconditions sequentially before scenario
steps. It records normal probe/oracle evidence, runs declared cleanup after a
failed check, and returns `blocked` without emitting a security finding.
Unsupported precondition probe kinds fail in the existing capability preflight.

## Consequences

Existing packs remain valid, but their string preconditions do not affect
execution. Pack authors requiring a gate must migrate to the structured form.
This contract is deliberately sequential and deterministic; parallel scenario
scheduling remains a separate policy decision because shared SUT isolation and
audit ordering must be proven first.
