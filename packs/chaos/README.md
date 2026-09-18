# `pack-chaos`

Opt-in contracts for controlled fault injection: approved experiment boundaries,
blast-radius budgets, safe degradation, recovery objectives and data integrity.

## Use it

Tag a project with `chaos`, `resilience`, `fault-injection` or
`disaster-recovery` and install the pack through the normal `aqa` pack workflow.

## Evidence boundary

The pack does not inject faults, terminate workloads or restore data itself. It
does not certify production resilience, RTO/RPO, customer impact or disaster
recovery. Run only against disposable or explicitly approved targets with an
owner, stop condition, rollback plan and bounded traffic; retain provider,
observability and recovery-drill evidence separately.
