# agentic-qa-kit — Terraform module
#
#   - Declares the Kubernetes namespace for the AQA stack.
#   - Optionally owns a pinned Helm release; platform teams may leave it off.

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = ">= 2.27.0"
    }
    helm = {
      source  = "hashicorp/helm"
      version = ">= 2.12.0"
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

variable "install_chart" {
  description = "Whether Terraform should install the AQA Helm chart."
  type        = bool
  default     = false
}

variable "chart_path" {
  description = "Path to a pinned AQA Helm chart directory or packaged chart."
  type        = string
  default     = ""
  validation {
    condition     = !var.install_chart || trimspace(var.chart_path) != ""
    error_message = "chart_path is required when install_chart is true."
  }
}

variable "release_name" {
  description = "Helm release name."
  type        = string
  default     = "aqa"
}

variable "helm_values" {
  description = "Additional values passed to the AQA Helm release."
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

resource "helm_release" "aqa" {
  count            = var.install_chart ? 1 : 0
  name             = var.release_name
  namespace        = kubernetes_namespace.aqa.metadata[0].name
  create_namespace = false
  chart            = var.chart_path
  atomic           = true
  cleanup_on_fail  = true
  wait             = true
  timeout          = 900
  values           = [yamlencode(var.helm_values)]
  depends_on       = [kubernetes_namespace.aqa]
}

output "namespace" {
  description = "The namespace AQA workloads run in."
  value       = kubernetes_namespace.aqa.metadata[0].name
}

output "release_name" {
  description = "Helm release name when chart installation is enabled."
  value       = var.install_chart ? helm_release.aqa[0].name : null
}
