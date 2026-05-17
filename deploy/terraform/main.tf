# agentic-qa-kit — Terraform module (v0.6 scaffold)
#
# What's here (v0.6):
#   - Declares the kubernetes namespace for the AQA stack.
#   - Declares variables for cluster connection + Postgres URL.
#
# What's NOT here yet (lands in v1.0):
#   - AWS RDS / GCP Cloud SQL submodules for managed Postgres.
#   - IRSA / Workload Identity bindings for runner pods.
#   - Helm release resource — operators run `helm install` themselves in
#     v0.6 so they can pin the chart version against the repo tag.

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = ">= 2.27.0"
    }
  }
}

variable "namespace" {
  description = "Kubernetes namespace for the AQA stack."
  type        = string
  default     = "agentic-qa-kit"
}

variable "labels" {
  description = "Extra labels applied to the namespace."
  type        = map(string)
  default     = {}
}

resource "kubernetes_namespace" "aqa" {
  metadata {
    name = var.namespace
    labels = merge(
      {
        "app.kubernetes.io/name"       = "agentic-qa-kit"
        "app.kubernetes.io/managed-by" = "terraform"
      },
      var.labels,
    )
  }
}

output "namespace" {
  description = "The namespace AQA workloads run in."
  value       = kubernetes_namespace.aqa.metadata[0].name
}
