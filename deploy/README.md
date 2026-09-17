# `deploy/` — operator-facing install assets

This directory contains the deployment assets for `agentic-qa-kit`
operators.

## Contents

- `helm/` — Helm chart for the AQA stack. The chart provides:
  server Deployment + Service, runner StatefulSet with stable identity
  and per-pod PVC, durable server audit PVC (enabled by default), startup/
  readiness/liveness probes, non-root/seccomp security contexts, optional
  Ingress, and NetworkPolicies that confine runner egress and restrict
  ingress-controller namespaces. The optional in-cluster Postgres subchart
  remains for dev / PoC.
- `terraform/` — minimal Terraform module to declare the AQA namespace.
  Cloud-provider submodules (AWS RDS, GCP Cloud SQL) + IRSA / Workload
  Identity land in a later release; the namespace + variable scaffold is
  stable.
- `../scripts/air-gap-install.sh` — `bundle`, `verify` and `install`
  subcommands. `install` verifies path safety and SHA-256, optionally verifies
  a Cosign blob signature, loads OCI image tarballs with Docker/Podman and
  performs `helm upgrade --install`.

## Operator requirements

- Set `networkPolicy.ingressNamespaceSelector` to the labels of the actual
  ingress-controller namespace; the default is `ingress-nginx` and does not
  permit every namespace.
- Keep `server.auditPersistence.enabled=true` in production and use a backed-up
  storage class. The audit PVC is not a substitute for Postgres/S3 backup or
  WORM retention.
- The chart uses TCP probes because the current server package exposes the
  framework-agnostic route table rather than a standalone health HTTP server;
  replace them with an authenticated-free application health endpoint when the
  deployable server wrapper is introduced.

## Why the scaffolds are explicit about v0.6 vs v1.0

Auditors and DevOps engineers reading this repo need to know **what is
runnable today vs. what is roadmap**. We prefer scaffolds that label
themselves than placeholder files that look complete but are not.
