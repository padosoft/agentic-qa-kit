# @aqa/ingest

Bounded ingestion contracts for external QA and security tooling.

Supported inputs include JUnit XML, Semgrep-compatible SAST JSON, k6 and
Locust performance summaries, and Playwright `trace.zip` files. Playwright
trace ingestion extracts only action names, bounded IDs, timing and error
messages; URLs, headers, request bodies and screenshots are deliberately not
copied into the normalized report.

- `parseJunit(xml)` normalizes Jest, Vitest, Pytest and CI JUnit XML results.
- `parseSast(json)` normalizes Semgrep-compatible results.
- Inputs are size bounded; JUnit external entities are rejected to prevent
  XXE. Records have stable fingerprints for later finding linkage.
- k6 and Locust retain numeric measurements (p95, failure/check rates) and
  `evaluatePerformanceThresholds(report, policy)` applies explicit CI policy
  in a separate, auditable step.
- `parseMutationSummary(json)` normalizes bounded flat or Stryker-style
  mutation reports. `evaluateMutationThreshold(report, minimumScore)` is the
  separate release gate; ignored mutants are excluded, while no-coverage,
  timeout and runtime/compile errors remain visible in the denominator.
- `parseMutationCoverageManifest(json)` and `evaluateMutationCoverage(...)`
  bind each evaluated mutant to reviewed risk/scenario IDs and gate mapping
  completeness plus kill rate, including a per-risk breakdown.
- `parseOtlpTrace(json)` accepts bounded OTLP/HTTP JSON traces and retains only
  trace/span identity, timing, service, status and primitive attributes. Known
  credential-bearing attributes and URLs are redacted before normalization.
- `federateTraceSources(sources)` merges span metadata by trace/span ID,
  deduplicates identical observations, and reports orphan parents and
  conflicting observations. Telemetry remains diagnostic, not audit truth.

Mutation parsing does not execute Stryker, mutmut or another mutator and does
not prove that the report was produced by a trusted job. The producer must be
run by a separately protected CI job, and the resulting report should be
bound to the source revision and artifact checkpoint before release use.

This package parses evidence; it does not mark AQA findings verified or merge
security findings automatically. That requires an explicit policy and audit
boundary.

Trace federation is intentionally bounded and fail-closed: at most 100,000
spans per document, 64 attributes per span and 64 sources per federation.
Provider exporters, authentication, transport integrity, sampling completeness,
clock quality and production retention remain deployment responsibilities and
must be proven by protected environment runs.
