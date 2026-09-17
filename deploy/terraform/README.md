# `deploy/terraform/` — Terraform module

The module declares the AQA Kubernetes namespace and can optionally install
the repository Helm chart. Managed PostgreSQL, IRSA and Workload Identity
remain provider-specific inputs rather than hidden cloud assumptions.

## Usage

```hcl
module "aqa" {
  source    = "github.com/padosoft/agentic-qa-kit//deploy/terraform?ref=v0.6.0"
  namespace = "aqa"
}
```

Set `install_chart = true` and provide a chart path or packaged chart when
Terraform should own the Helm release. Keep `install_chart = false` when a
platform team owns Helm deployments.
