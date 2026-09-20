# AQA sizing and capacity planning

This is the reproducible starting point for planning a self-hosted AQA
deployment. The reference figures are engineering envelopes, not provider
SLOs: they must be replaced by measurements from the target database,
artifact store, runner image, probe mix and network perimeter before a
production commitment.

## Reference profiles

| Profile | Concurrent projects | Concurrent runners | Runs/day | Control plane baseline | Durable storage/day |
| --- | ---: | ---: | ---: | --- | ---: |
| Small | 5 | 2 | 50 | 2 vCPU / 4 GB RAM / small PostgreSQL | 1–2 GB |
| Medium | 50 | 20 | 500 | 8 vCPU / 16 GB RAM / PostgreSQL medium + queue fan-out | 10–25 GB |
| Large | 500 | 200 | 5,000 | 3 × 16 vCPU / 64 GB RAM / HA PostgreSQL + durable queue + S3 | 100–250 GB |

Storage depends more on evidence policy than on run count. Estimate it with:

```text
daily_storage = runs_per_day × (events_per_run × avg_event_bytes
                 + findings_per_run × avg_finding_bytes
                 + replay_artifacts_per_run × avg_artifact_bytes)
                 × retention_replication_factor
```

Add at least 30% headroom for retries, failed runs, index growth and provider
metadata. Keep audit events, replay artifacts and screenshots in separate
retention classes; never solve storage pressure by silently deleting a chain
prefix.

## Capacity dimensions

Measure these independently because one bottleneck can hide another:

- queue admission and lease throughput (jobs/second);
- scenario execution concurrency and runner heartbeat freshness;
- API p50/p95/p99 latency and error budget consumption;
- PostgreSQL connections, lock waits, WAL volume and query latency;
- artifact PUT/GET throughput, object count and retention growth;
- telemetry export queue depth and dropped-span count;
- sandbox CPU, memory, process count, output bytes and timeout rate.

The control plane must remain useful when runners are saturated. Admission
quotas, per-tenant fairness and bounded queues are therefore part of the
capacity model, not optional tuning.

## Reproducible local baseline

Run the provider-neutral queue baseline after building the workspace:

```text
bun run benchmark:capacity
```

The command emits JSON containing the source revision, job count, elapsed
milliseconds, operations/second and a `scope` of `memory-runner-queue`. It
does not claim PostgreSQL, S3, network, sandbox or browser capacity. Compare
results only on the same OS/runtime and retain the JSON beside the experiment
plan; do not put credentials or customer payloads in it.

For a custom local run, build once and invoke the script directly:

```text
bun run build:workspace
node scripts/capacity-benchmark.mjs --jobs 10000 --runs 5
```

For a deployment claim, repeat the same workload with the real queue,
artifact backend, runner image and representative probe mix, then record:

1. warm-up and measurement duration;
2. runner count and resource limits;
3. tenant/project distribution and scenario mix;
4. p50/p95/p99, failures, retries, lease expiries and dropped telemetry;
5. database and artifact-store saturation signals;
6. pass/fail thresholds and the exact source/image revisions.

Those provider-backed measurements remain a final promotion gate until an
operator-owned environment is available.

## Scaling rules

- Scale runners horizontally before increasing per-runner concurrency when
  probes are CPU-, browser- or sandbox-bound.
- Keep one queue lease subject per runner identity; do not use a shared static
  bearer credential to infer worker provenance.
- Size PostgreSQL for peak concurrent leases plus audit writes, not average
  runs/day. Test reconnect and expired-lease reaping under load.
- Keep artifact uploads off the API request path and enforce bounded upload,
  retention and redaction policies.
- Treat the first observed SLO breach as a capacity signal; do not increase
  timeouts until queue age, retries and resource saturation are understood.

## Evidence boundary

This document and the local benchmark close the repository-side sizing
contract. They do not prove HA, RTO/RPO, provider durability, Kubernetes
autoscaling, multi-region behavior or production SLOs.
