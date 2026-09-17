# ADR-033: Conservative root-cause clustering

## Status

Accepted

## Decision

Cross-run findings receive a stable `root_cause_id` only when they share the
existing deterministic fingerprint. Clusters expose an explainable priority
score: severity weight × confidence × blast radius ÷ cost-to-fix estimate.
Business estimates are optional, positive, finite and bounded; neutral value
`1` is used when absent.

Embedding similarity, automatic cross-fingerprint merges and automatic bulk
closure are not enabled by this primitive. They require explicit evidence and
human/audited approval workflows.

## Consequences

Repeated findings can be triaged and ranked consistently without hiding
distinct defects. A future semantic clustering service may suggest links, but
must preserve the deterministic signature and record who accepted a link.
