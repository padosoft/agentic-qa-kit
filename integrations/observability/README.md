# AQA observability deployment assets

This directory contains provider-neutral assets for wiring Agentic QA Kit into
an existing OpenTelemetry, Prometheus and Grafana platform.

These files are production-shaped configuration, not proof that a provider is
reachable. A deployment must still supply the Collector endpoints, secure the
metrics route, provision the Prometheus/Grafana data sources, and capture live
scrape/export evidence through the approved operator process.

## Contents

- `otel-collector/config.yaml` — OTLP gRPC/HTTP receiver with bounded memory,
  batching, Prometheus metrics export and OTLP trace export.
- `prometheus/aqa-rules.yml` — recording rules and alerts for run failures,
  queue backpressure, LLM budget denials and missing telemetry.
- `grafana/aqa-overview.json` — importable dashboard using Prometheus metrics;
  it contains no credentials or environment-specific URLs.

## Installation

1. Deploy the Collector with a non-root identity and a resource limit.
2. Set `AQA_TEMPO_ENDPOINT` (or replace the example exporter endpoint) and
   configure the Collector's TLS/authentication according to the platform.
3. Expose `GET /metrics` only on a protected network path and configure the
   Prometheus scrape with the same operator authorization policy.
4. Load `prometheus/aqa-rules.yml` into the Prometheus rule evaluator.
5. Import the Grafana dashboard and bind its Prometheus data source.
6. Run a real AQA journey and retain evidence of a successful scrape, OTLP
   export, alert evaluation and dashboard data population.

The repository's hosted Docker journey can be run with:

```bash
AQA_TEST_OBSERVABILITY_LIVE=1 bun run test:observability-live
```

It starts disposable Prometheus and OpenTelemetry Collector containers,
scrapes the real admin `/metrics` endpoint, queries the scraped series, and
exports a real span through OTLP/HTTP. It is intentionally skipped without the
explicit environment variable because Docker/provider availability is not
assumed on developer machines.

The configuration intentionally uses environment substitution for endpoints and
does not contain tokens, passwords or signing keys.
