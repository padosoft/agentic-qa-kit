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
- OIDC is disabled by default. To enable the enterprise login boundary, set
  `auth.oidc.enabled=true`, provide `issuer`, `clientId`, `redirectUri` and a
  Secret reference for `clientSecretSecretRef`/`clientSecretKey`, and configure
  a PostgreSQL source. The chart projects the secret into the named
  `clientSecretEnv` without printing it; `aqa admin` then constructs the
  provider-neutral OIDC adapter and `PostgresOidcSessionStore` from the
  environment. Partial OIDC configuration fails closed, and an OIDC-enabled
  deployment never falls back to the local admin identity. The redirect URI
  must point to `/auth/callback` on the public HTTPS origin.
- Enable the real worker in production with
  `runner.worker.enabled=true`, set `runner.worker.scopes` to explicit
  `org/project` or `org/*` entries, and use `runner.worker.queueDsnSecretRef`
  (or the shared `postgres.urlSecretRef`). The worker fails closed when the
  DSN/scopes/token are absent; it uses the authenticated HTTP queue when
  `AQA_SERVER_URL` and a projected runner token are configured, otherwise it
  uses the direct PostgreSQL queue for explicitly local deployments. The token
  file is read for every queue request, so projected Secret rotation does not
  require a worker restart. It runs `aqa worker` and uses the configured root,
  never a client-supplied filesystem path. Create `runner.worker.tokenSecretRef`
  with the short-lived JWT under `runner.worker.tokenSecretKey`.
- Additional probe drivers are an explicit runner policy under
  `runner.worker.probeDrivers` and are disabled by default. PostgreSQL SQL
  probes require a Secret reference (`dsnSecretRef`/`dsnSecretKey`); Playwright
  requires an explicit origin list; shell requires an executable allowlist and
  always runs through direct argv. Queue payloads cannot change this policy.
  For a managed SQL target, add its CIDR to
  `networkPolicy.runnerExtraEgressCidrs`; the chart cannot infer network
  identity from a Secret DSN.
- Pin server and runner images by digest in production and set both
  `server.image.requireDigest=true` and `runner.image.requireDigest=true`.
  The chart fails during render when a required digest is missing; mutable tags
  remain available only for development/PoC values.
- Publish a signed `ProductionEvidence` envelope from the approved SRE/security
  process and configure `AQA_PRODUCTION_EVIDENCE_PATH` plus its trusted public
  key. `aqa doctor --production` verifies its integrity and completeness but
  does not contact KMS, WORM, PostgreSQL or the IdP; see
  `docs/operations/production-evidence.md`.
- The chart uses TCP probes because the current server package exposes the
  framework-agnostic route table rather than a standalone health HTTP server;
  replace them with an authenticated-free application health endpoint when the
  deployable server wrapper is introduced.

## Why the scaffolds are explicit about v0.6 vs v1.0

Auditors and DevOps engineers reading this repo need to know **what is
runnable today vs. what is roadmap**. We prefer scaffolds that label
themselves than placeholder files that look complete but are not.
