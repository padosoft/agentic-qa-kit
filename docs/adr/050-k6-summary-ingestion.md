# ADR-050 — k6 performance summary ingestion

## Status

Accepted — 2026-09-17

## Context

Performance tools already execute outside AQA. Treating a load-test command’s exit code as a QA finding loses p95 latency, failed-request rate and check-rate evidence, and makes release gates impossible to compare across runs.

## Decision

`@aqa/ingest` accepts bounded k6 and Locust JSON summary shapes and normalizes numeric metrics into the existing fingerprinted `IngestReport`. k6 `http_req_duration` preserves `p(95)` as `duration_ms`; non-zero `http_req_failed` and check rates below one become failed records. Locust request stats preserve p95 and mark non-zero failures explicitly. Malformed or empty summaries fail closed.

The adapters do not run load tools, infer thresholds that were not present in the summary, or treat a load-test result as proof of functional correctness. Threshold policy remains a separate integration.

## Evidence

Ingest typecheck, 8/8 tests, repository lint and diff check pass.
