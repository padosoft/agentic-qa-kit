# ADR-050 — k6 performance summary ingestion

## Status

Accepted — 2026-09-17

## Context

Performance tools already execute outside AQA. Treating a load-test command’s exit code as a QA finding loses p95 latency, failed-request rate and check-rate evidence, and makes release gates impossible to compare across runs.

## Decision

`@aqa/ingest` accepts the bounded k6 JSON summary shape and normalizes numeric metrics into the existing fingerprinted `IngestReport`. `http_req_duration` preserves `p(95)` as `duration_ms`; non-zero `http_req_failed` and check rates below one become failed records. Malformed or entirely non-numeric summaries fail closed.

The adapter does not run k6, infer thresholds that were not present in the summary, or treat a load-test result as proof of functional correctness. Threshold policy and Locust mapping remain separate integrations.

## Evidence

Ingest typecheck, 6/6 tests, repository lint and diff check pass.
