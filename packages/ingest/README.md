# @aqa/ingest

Bounded ingestion contracts for external QA and security tooling.

- `parseJunit(xml)` normalizes Jest, Vitest, Pytest and CI JUnit XML results.
- `parseSast(json)` normalizes Semgrep-compatible results.
- Inputs are size bounded; JUnit external entities are rejected to prevent
  XXE. Records have stable fingerprints for later finding linkage.

This package parses evidence; it does not mark AQA findings verified or merge
security findings automatically. That requires an explicit policy and audit
boundary.
