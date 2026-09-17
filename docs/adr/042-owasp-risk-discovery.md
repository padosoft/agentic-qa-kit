# ADR-042: Deterministic OWASP risk discovery

## Status

Accepted — baseline catalog shipped; source-aware and assisted discovery remain open.

## Decision

`aqa risk discover --method owasp` generates ten bounded OWASP-aligned risks,
each with a stable method-prefixed ID, one executable invariant, framework tag,
scope tag and schema validation. The existing STRIDE method remains available.

Generated risks are reviewable hypotheses. The command does not inspect source
code, infer application-specific truth or mark a risk approved.

## Consequences

Teams can bootstrap a second recognized methodology without changing the risk
map contract. FMEA, attack trees, AST/source analysis, LLM-assisted proposals
and human approval/versioning require separate evidence and remain explicitly
unclaimed.
