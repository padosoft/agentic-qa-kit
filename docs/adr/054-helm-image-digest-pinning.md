# ADR-054 — Helm image digest pinning

## Status

Accepted — 2026-09-17

## Decision

The Helm chart accepts an image `digest` for server and runner and renders `repository@digest` when supplied. Each image also has `requireDigest`; enabling it makes Helm fail before deployment when the digest is absent. Defaults remain tag-based for local development and PoC compatibility.

Production release manifests must set both requirements, record the image digest/SBOM provenance and update them through a reviewed change. A tag-only render is not supply-chain identity evidence.

## Evidence

Chart templates and operator documentation now expose an explicit fail-closed digest policy. Kubernetes render/upgrade validation remains a deployment-environment gate.
