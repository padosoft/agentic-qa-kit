# ADR-209: Bounded versioned test-data fixtures

## Status

Accepted — 2026-09-18

## Context

The roadmap requires repeatable test data without encouraging teams to copy
production exports, credentials or arbitrary files into `.aqa/`. A generic
snapshot command would create an unbounded data-leak and path-traversal risk.

## Decision

The first fixture contract is deliberately narrow:

- snapshots accept JSON files only, with limits of 1,000 files, 10 MiB per
  file and 100 MiB total;
- manifests record schema version, fixture id, timestamp, anonymization mode,
  per-file byte count and SHA-256 digest;
- `--anonymize` deterministically replaces common PII/credential fields while
  preserving stable joins inside the same key/value domain;
- restore validates the manifest, every path, size and digest, stays under the
  project root and refuses overwrite unless `--force` is explicit;
- failures are fail-closed and never print fixture contents.

Provider extraction from staging, distribution-preserving anonymization and
ephemeral scratch tenants are intentionally separate integrations; this local
contract must not imply access to production data.

## Consequences

Fixtures are reviewable and reproducible in Git or an artifact store, with a
small, auditable attack surface. Teams needing CSV/Parquet/database snapshots
must add a format-specific, redacting adapter rather than widening this
primitive implicitly.
