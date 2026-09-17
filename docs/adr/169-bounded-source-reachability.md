# ADR-169: Filter source-aware discovery through a bounded import graph

## Context

The source-aware risk method detects relevant markers, but scanning every file
can promote dead code, fixtures and abandoned migrations into active risk
evidence. A useful next layer is reachability evidence without executing
untrusted project code.

## Decision

Build a bounded JS/TS relative-import graph from the already bounded file set.
Start at conventional entrypoint names (`index`, `main`, `app`, `server`,
`cli`, `start`, `bootstrap`) when available; otherwise use files that are not
imported by another scanned file. Traverse only relative imports with known
extensions, and always retain dependency-boundary manifests. Source rules run only on this reachable set and
emit the stable tag `reachability:bounded-import-graph`.

The resolver does not evaluate aliases, package exports, dynamic imports,
generated code or language-specific graphs. Those limitations are part of the
evidence contract and must remain visible to operators.

## Evidence and boundary

Kit tests cover reachable source evidence and an unreachable marker file.
This reduces one class of false positives; it is not proof of complete
reachability, semantic data flow, vulnerability exploitability or production
security coverage.
