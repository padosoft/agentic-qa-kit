# 275 — Holdout calibration for semantic finding clustering

- **Status:** accepted
- **Date:** 2026-09-19
- **Deciders:** maintainers
- **Tags:** methodology, calibration, clustering

## Context

The semantic clustering threshold was already measured against reviewed pairs,
but using the same corpus to tune and report quality can overfit the threshold.
The v0.6 methodology gate needs an explicit unseen evaluation set while
preserving deterministic replay and bounded artifacts.

## Decision

Add deterministic `splitSimilarityCalibrationHoldout` and
`calibrateSimilarityHoldout`. The split ranks sample indices by a SHA-256 of an
operator seed and index, keeps bounded non-empty train and holdout sets, and
emits a digest of the split. Threshold calibration is reported for both sets,
but release policy is evaluated only against the holdout report.

## Consequences

### Positive

- Threshold quality is measured on reviewed pairs not used for calibration.
- The split is reproducible and auditable without persisting raw embeddings.
- Holdout failures become explicit release input instead of hidden overfit.

### Negative / trade-offs

- Holdout labels are still operator-reviewed and may be biased or too small.
- This does not constitute independent methodology validation or external
  governance.

### Neutral / follow-ups

- Require a versioned gold corpus and independent reviewer sign-off for a
  production release policy.

## Alternatives considered

- **Report on the full tuning corpus:** rejected because it hides threshold
  overfitting.
- **Random non-seeded split:** rejected because it breaks reproducible evidence
  and replay.

## References

- ADR-269 — Semantic similarity calibration
- `packages/clustering/src/cluster.ts`
