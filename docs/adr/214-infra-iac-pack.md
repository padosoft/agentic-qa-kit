# ADR-214: Ship an opt-in infrastructure IaC safety pack

## Status

Accepted — 2026-09-18

## Decision

Ship `pack-infra-iac` with contracts for destructive plan review, drift
correlation/ownership and policy-gated release decisions.

## Boundary

The pack does not apply infrastructure or prove provider-backed production
health. State locking, IAM, recovery and apply evidence remain separate
operator-controlled journeys.
