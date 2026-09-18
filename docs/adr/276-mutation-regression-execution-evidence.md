# ADR-276: Mutation regression execution evidence

## Context

The original mutation coverage gate proved only that a reviewed manifest linked
mutants to scenarios and that an external report declared a kill rate. It did
not prove that those scenarios actually executed, or that their outcomes agreed
with the report.

## Decision

Add a bounded, metadata-only evidence contract and `aqa mutation regression`
gate. Each reviewed mutant/scenario pair must have exactly one observation with
`run_id`, `source_revision` and `killed`/`survived` outcome. Unknown pairs,
missing pairs and disagreement with the mutation report fail closed. The
contract does not execute project code and does not accept payloads, logs or
secrets.

## Consequences

Repository automation can distinguish mapping from observed regression
execution and can retain a minimal audit trail. A protected producer still
must execute the mutator and scenarios, bind artifacts to the revision and
publish provenance; this ADR does not claim live provider evidence or scale.
