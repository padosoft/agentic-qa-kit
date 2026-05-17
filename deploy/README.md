# `deploy/` — operator-facing install assets

This directory contains the deployment scaffolds for `agentic-qa-kit`
operators (Task 22). They are intentionally minimal in v0.6 — what lands now
is the **shape**, not a production-ready chart.

## Contents

- `helm/` — Helm chart skeleton for the AQA stack (`server`, `runner` pool,
  Postgres dep). v0.6 ships values + a single `Deployment` template for the
  server; the runner-pool `StatefulSet`, ingress, and NetworkPolicy land in
  v1.0 alongside SOC2 readiness work.
- `terraform/` — minimal Terraform module to declare the AQA namespace +
  Postgres instance. v0.6 ships variable declarations and the namespace
  resource. Cloud-provider modules (AWS RDS, GCP Cloud SQL) land in v1.0.
- `../scripts/air-gap-install.sh` — bundle/install workflow for environments
  without registry access. v0.6 ships the bundle-export side; the install
  side land in v1.0 once the Helm chart is complete.

## Why the scaffolds are explicit about v0.6 vs v1.0

Auditors and DevOps engineers reading this repo need to know **what is
runnable today vs. what is roadmap**. We prefer scaffolds that label
themselves than placeholder files that look complete but are not.
