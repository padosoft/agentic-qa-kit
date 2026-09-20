# Bounded load and chaos evidence

This runbook defines repository-side queue evidence that can be produced
without provider credentials. It is bounded and deterministic, and exercises
the real `RunnerQueue` implementation rather than a fake benchmark fixture.

## Run

```bash
bun run benchmark:chaos
bun run build:workspace && node scripts/chaos-benchmark.mjs --jobs 1000 --runs 5 --max-attempts 3
```

The script also rebuilds `@aqa/server` immediately before loading the queue,
so source attribution cannot silently use a stale ignored `dist/` tree.

The command emits one JSON document containing the source revision, thresholds,
per-run terminal accounting and an explicit evidence boundary. It refuses a
dirty worktree (apart from `.claude/scheduled_tasks.lock`) so a result cannot
be presented as evidence for code that was not committed.

## Fault model and SLOs

The harness injects a stable schedule of a small number of explicit worker
failures and many expired leases. Retries are handled by the production queue
implementation; terminal state must reconcile to the exact number of enqueued
jobs. The default local probe requires at least 95% completed jobs and zero
jobs stranded in `queued` or `in_flight`, with explicit accounting for failed
jobs, lease expiries and injected failures.

These thresholds are a local contract, not a production availability promise.
They must be calibrated against workload and business SLOs before becoming a
release gate.

## Evidence boundary

This probe does not prove PostgreSQL concurrency, network behavior, provider
settlement, horizontal fairness, durable recovery, production-scale throughput,
or RTO/RPO. Those require protected provider/deployment workflows and
operator-owned environments listed in the roadmap completion audit.
