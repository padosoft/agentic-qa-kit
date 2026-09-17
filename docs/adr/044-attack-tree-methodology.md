# ADR-044: Bounded attack-tree methodology

## Status

Accepted — in-memory contract shipped; persistence and UI remain open.

## Decision

`@aqa/methodology` models attack trees as bounded `all`/`any` nodes and leaves.
Validation requires safe IDs, non-empty statements, unique nodes and bounded
depth/fan-out/total nodes. Evaluation is pure and accepts only an explicit set
of compromised leaf IDs. `attackTreeForRisk()` derives a conservative tree from
declared invariants without inventing observations.

## Consequences

Attack reasoning is deterministic and safe to serialize later, with no hidden
LLM judgment in the evaluator. A durable graph schema, admin visualization,
source-aware derivation and human approval workflow remain required for an
enterprise attack-tree product.
