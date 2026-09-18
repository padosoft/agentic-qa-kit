# ADR-216: Ship an opt-in Kubernetes safety pack

## Status

Accepted — 2026-09-18

## Decision

Ship `pack-kubernetes` with contracts for manifest hardening, admission policy
and rollout/disruption resilience.

## Boundary

The pack does not operate a cluster or certify runtime security. Cluster,
image, network, control-plane and rollback evidence must come from an operator
controlled disposable/staging environment.
