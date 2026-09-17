# @aqa/ingest

Bounded ingestion contracts for external QA and security tooling.

- `parseJunit(xml)` normalizes Jest, Vitest, Pytest and CI JUnit XML results.
- `parseSast(json)` normalizes Semgrep-compatible results.
- Inputs are size bounded; JUnit external entities are rejected to prevent
  XXE. Records have stable fingerprints for later finding linkage.
- k6 and Locust retain numeric measurements (p95, failure/check rates) and
  `evaluatePerformanceThresholds(report, policy)` applies explicit CI policy
  in a separate, auditable step.

This package parses evidence; it does not mark AQA findings verified or merge
security findings automatically. That requires an explicit policy and audit
boundary.
