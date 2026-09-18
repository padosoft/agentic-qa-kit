# @aqa/clustering

Cross-run findings dedup + clustering for the admin panel's Findings Kanban
(Task 20).

- `signatureOf(finding)` — sha256 of `(scenario_id, risk_id, normalised_summary)`.
  Two findings of "the same bug" across runs collapse into one signature.
- `clusterFindings(findings)` — groups by signature; chooses the earliest
  member as the representative; reports the worst severity, a stable
  `root_cause_id`, and an explainable priority score in the cluster.
- `clusterFindingsBySimilarity(findings, options)` — creates explicit,
  explainable semantic candidate links across scenarios of the same risk.
  It uses bounded deterministic token similarity by default or an
  operator-owned embedding callback, and retains every edge (score, method,
  member IDs) that caused a connected component.
- `calibrateSimilarityThreshold(samples, threshold)` and
  `evaluateSimilarityCalibration(report, policy)` — measure precision, recall
  and false-positive rate on human-reviewed pairs before enabling a semantic
  grouping threshold in release policy.
- `priorityOf(finding)` — computes bounded severity × confidence × blast radius
  / fix cost. Missing optional business estimates use neutral value `1`.

Clustering is deliberately conservative: similarity links never cross risk
boundaries, require an explicit threshold, and never persist raw embedding
vectors. Embedding similarity is opt-in; an ambiguous result remains a
separate finding until a caller supplies a suitable threshold and policy.

This is intentionally a small static layer; the in-run dedup already lives
in `@aqa/runner`'s `FindingsWriter`. Clustering across runs is purely
post-hoc.
