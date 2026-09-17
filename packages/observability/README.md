# `@aqa/observability`

Provider-neutral observability primitives for production AQA deployments.

## Features

- W3C `traceparent` parsing/formatting and trace/span correlation.
- In-process spans with exporter injection (OTel, OTLP, or a local sink can
  be added without changing runner contracts).
- Prometheus text exposition for counters, gauges and bounded histograms.
- Cardinality limits to prevent untrusted scenario/project labels exhausting
  the process.
- Structured JSON logs with pre-write secret redaction.
- Shared DLP redaction for text/JSON evidence: bearer/JWT/AWS keys, email,
  Luhn-validated PANs, IBANs, IPv4 addresses, contextual high-entropy secret
  assignments and operator-supplied patterns.
- `evaluateSlo()` for pure SLO/error-budget decisions with explicit
  `healthy`/`warning`/`breached` status and no-data handling.

The package deliberately has no cloud SDK dependency. Production deployments
should export spans and metrics to their existing OTel Collector/Prometheus
stack and keep high-cardinality identifiers out of metric labels.

```ts
import { MetricsRegistry, Tracer, parseTraceParent } from '@aqa/observability';

const metrics = new MetricsRegistry();
metrics.counter('aqa_run_started_total', { project: 'shop' });
const parent = parseTraceParent(request.headers.traceparent);
const span = new Tracer(console.log).startSpan('aqa.run', { run_id: runId }, parent);
span.end();
```

Evidence writers should use `redactText()` / `redactJson()` before persistence.
Custom organization-specific patterns can be passed through `customPatterns`;
binary evidence is not transformed and requires an explicit classification
policy at the artifact boundary.
