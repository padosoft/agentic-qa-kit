# ADR-167: Add bounded source-aware risk discovery

## Status

Accepted

## Context

Static STRIDE, OWASP and FMEA baselines are useful but identical for every
repository. The roadmap requires source-aware discovery while preserving the
fail-safe rule that generated risks are hypotheses requiring review.

## Decision

`aqa risk discover --method source` scans at most 200 bounded source/manifest
files, skips `.git`, `node_modules`, `dist` and `.aqa`, and detects four
explainable signal families: authentication, interpreter/database, outbound
requests and secret material. It emits only matched risks, includes up to five
relative evidence paths as tags, and carries the observed signal description
into the RiskMap. No source is sent to an LLM or written to the output map.

## Evidence and boundary

Risk-discovery tests pass 6/6 locally; kit build, bundle, typecheck and lint
pass. This is a bounded deterministic heuristic and does not replace AST,
dependency reachability, LLM-assisted hypotheses, penetration testing or human
approval.
