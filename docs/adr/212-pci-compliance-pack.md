# ADR-212: Ship an opt-in PCI payment-data safety pack

## Status

Accepted — 2026-09-18

## Decision

Ship `pack-compliance-pci` with provider-neutral scenarios for payment evidence
redaction, tokenization boundaries and deny-by-default segmentation.

## Boundary

The pack is a QA baseline, not a PCI-DSS certification or QSA assessment. It
must run only with seeded sandbox fixtures and requires independent evidence for
provider scope, key management, segmentation, retention and operational access.
