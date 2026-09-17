# ADR-173: Expose risk coverage as a fail-closed CLI gate

## Context

The methodology package could calculate coverage, but operators had no
canonical command connecting RiskMap declarations, pack scenarios and
persisted run events. Counting findings alone cannot prove that a critical
risk was exercised or that evidence is fresh.

## Decision

Add `aqa risk coverage [--profile <name>]`. It loads project and selected
pack declarations, validates scenario and audit event schemas, measures
invariant/scenario/oracle/replay/pass-rate/flake coverage, and reports
`covered`, `partial`, `gap` or `stale`. Invalid evidence fails with exit 1;
valid but incomplete coverage fails with exit 2. No findings is never treated
as coverage success.

## Evidence and boundary

Kit tests cover a fresh passing evidence set and a no-run stale result. The
command does not verify cryptographic event-chain integrity itself or prove
provider/cluster journey semantics; those remain separate evidence layers.
