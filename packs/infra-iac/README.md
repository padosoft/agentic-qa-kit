# Infrastructure IaC pack

This opt-in, provider-neutral baseline checks three infrastructure contracts:
destructive plan visibility, drift ownership/correlation and policy-gated
release decisions.

The endpoints are placeholders for Terraform/Pulumi/CDK or an internal
adapter. Run against disposable or staging environments only. A passing pack
does not prove provider availability, IAM correctness, state-lock safety,
backup/recovery, network isolation or production infrastructure health; those
need provider-backed evidence and controlled apply/restore drills.
