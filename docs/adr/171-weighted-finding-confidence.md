# ADR-171: Derive finding confidence from oracle weights

## Context

Scenarios already declare an explicit weight for each oracle, but the runner
previously averaged oracle agreement equally. That made a low-value assertion
change a finding's confidence as much as a high-value invariant oracle.

## Decision

Compute `oracle_agreement` as the weighted mean of the evaluated oracle
agreements using the scenario weights. A zero total weight produces confidence
zero. Severity still comes from the resolved risk declaration; confidence is
not a claim that the defect is absent or present, only the deterministic
agreement score of the declared oracles.

## Evidence and boundary

Runner tests cover a one-to-three weight split and assert the persisted finding
confidence. This does not calibrate confidence against historical false
positive rates or prove that oracle weights are well chosen by each project.
