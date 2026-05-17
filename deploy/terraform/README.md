# `deploy/terraform/` — Terraform module (v0.6 scaffold)

Minimal module that declares the AQA Kubernetes namespace and exports it.

## Usage

```hcl
module "aqa" {
  source    = "github.com/padosoft/agentic-qa-kit//deploy/terraform?ref=v0.6.0"
  namespace = "aqa"
}
```

## Roadmap

- v0.6 — namespace + variable scaffold (you are here).
- v1.0 — RDS / Cloud SQL submodules, IRSA / Workload Identity, Helm release.
