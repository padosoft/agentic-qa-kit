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
- Configure `postgres.urlSecretRef` (secret key `url`) or a deliberately
  controlled `postgres.url`. The chart maps the same database endpoint to the
  control-plane store, runner queue, shared OIDC sessions and EventBus; the
  application still owns migrations and least-privilege database roles.
- Enable the real worker in production with
  `runner.worker.enabled=true`, set `runner.worker.scopes` to explicit
  `org/project` or `org/*` entries, and use `runner.worker.queueDsnSecretRef`
  (or the shared `postgres.urlSecretRef`). The worker fails closed when the
  DSN or scopes are absent; it runs `aqa worker` and uses the configured root,
  never a client-supplied filesystem path.
- Pin server and runner images by digest in production and set both
  `server.image.requireDigest=true` and `runner.image.requireDigest=true`.
  The chart fails during render when a required digest is missing; mutable tags
  remain available only for development/PoC values.
- The chart uses TCP probes because the current server package exposes the
  framework-agnostic route table rather than a standalone health HTTP server;
  replace them with an authenticated-free application health endpoint when the
  deployable server wrapper is introduced.

## Why the scaffolds are explicit about v0.6 vs v1.0

Auditors and DevOps engineers reading this repo need to know **what is
runnable today vs. what is roadmap**. We prefer scaffolds that label
themselves than placeholder files that look complete but are not.
