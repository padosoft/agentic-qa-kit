# @aqa/clustering

Cross-run findings dedup + clustering for the admin panel's Findings Kanban
(Task 20).

- `signatureOf(finding)` — sha256 of `(scenario_id, risk_id, normalised_summary)`.
  Two findings of "the same bug" across runs collapse into one signature.
- `clusterFindings(findings)` — groups by signature; chooses the earliest
  member as the representative; reports the worst severity in the cluster.

This is intentionally a small static layer; the in-run dedup already lives
in `@aqa/runner`'s `FindingsWriter`. Clustering across runs is purely
post-hoc.
