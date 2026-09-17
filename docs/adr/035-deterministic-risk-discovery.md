# ADR-035: Deterministic risk discovery baseline

## Status

Accepted

## Decision

`aqa risk discover --method stride` generates a schema-validated baseline for
the six STRIDE threat classes. Each entry has an AQA category, severity,
likelihood, one verifiable invariant and an explicit scope tag. The operation
does not overwrite an existing risk map without `--force`, and rejects
traversal/symlink write targets.

The baseline is a reviewable starting point, not a claim that static code or an
LLM has discovered every project-specific risk. Additional methods must have
their own deterministic output contract and evidence tests.

## Consequences

New projects can bootstrap a useful threat inventory without network or model
credentials. Teams still need to review, refine and version the map; FMEA,
OWASP catalogs, attack trees and source-aware discovery are follow-up methods.
