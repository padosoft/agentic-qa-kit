# `deploy/` — operator-facing install assets

This directory contains the deployment assets for `agentic-qa-kit`
operators.

## Contents

- `helm/` — Helm chart for the AQA stack. **v1.1 ships the full chart**:
  server Deployment + Service, runner StatefulSet with stable identity
  and per-pod PVC, optional Ingress, NetworkPolicy that confines runner
  egress, and an optional in-cluster Postgres subchart for dev / PoC.
- `terraform/` — minimal Terraform module to declare the AQA namespace.
  Cloud-provider submodules (AWS RDS, GCP Cloud SQL) + IRSA / Workload
  Identity land in a later release; the namespace + variable scaffold is
  stable.
- `../scripts/air-gap-install.sh` — `bundle` + `verify` subcommands. The
  `install` subcommand + cosign verification of the bundle land in a
  later release.

## Why the scaffolds are explicit about v0.6 vs v1.0

Auditors and DevOps engineers reading this repo need to know **what is
runnable today vs. what is roadmap**. We prefer scaffolds that label
themselves than placeholder files that look complete but are not.
