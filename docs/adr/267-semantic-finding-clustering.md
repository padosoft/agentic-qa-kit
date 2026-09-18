# ADR-267: Explainable semantic finding clustering

## Status

Accepted

## Context

Exact fingerprints prevent duplicate spam only when scenario/risk and the
normalized summary match. The same root issue can otherwise appear with a
different scenario, wording or agent run. Automatic unrestricted semantic
merging would create dangerous false deduplications in a security product.

## Decision

Add `clusterFindingsBySimilarity()` as an explicit post-hoc operation. It
creates connected components only between findings with the same `risk_id`,
using a caller-supplied threshold. The default score is deterministic bounded
token Jaccard similarity; an operator may provide a bounded embedding
function. Every accepted edge records both member IDs, score and method, so a
reviewer can explain why a root-cause group exists. Raw vectors are never
persisted.

## Consequences

The package now supports semantic candidate grouping without silently
claiming that two unrelated vulnerabilities are identical. A production
policy must calibrate thresholds on reviewed examples and may require human
approval before bulk duplicate status changes. This is clustering evidence,
not an automatic finding closure or a replacement for regression replay.
