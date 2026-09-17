# ADR-043: Deterministic FMEA risk discovery

## Status

Accepted — baseline catalog shipped; scored operational FMEA remains open.

## Decision

`aqa risk discover --method fmea` generates six stable failure-mode risks with
an invariant for acceptance criteria, boundary validation, dependency failure,
concurrency, configuration drift and detection. The output shares the RiskMap
schema and safe overwrite rules with STRIDE and OWASP.

The catalog does not invent occurrence/detection scores from absent production
data. It is a hypothesis set for review and later enrichment.

## Consequences

Teams can start a failure-mode analysis from the same portable artifact and
connect it to scenarios/oracles. Quantitative RPN scoring, process-specific
cause trees and human approval/versioning require further evidence.
