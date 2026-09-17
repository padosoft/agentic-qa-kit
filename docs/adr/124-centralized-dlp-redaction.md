# ADR-124: centralized DLP redaction for textual evidence

## Status

Accepted

## Context

Findings, audit events, SQL rows, shell output, browser text and artifacts
previously carried near-identical redaction functions in multiple packages.
That allowed coverage drift and made false positives dangerous: a broad
numeric pattern can corrupt run IDs and timestamps while a narrow pattern can
miss a secret in another evidence path.

## Decision

`@aqa/observability` owns the shared `redactText()` and `redactJson()` policy.
Runner, artifact and telemetry paths use that implementation; the artifacts
package re-exports the functions for compatibility. PAN detection accepts
13–19 digit values with common separators only when the Luhn checksum passes,
avoiding accidental redaction of dates and identifiers. JSON keys containing
credential/PII names are still redacted regardless of value format.

## Consequences

Textual evidence has one versioned policy and one regression surface. Binary
artifacts are intentionally not transformed; callers must classify or reject
them before persistence when they can contain screenshots, PDFs or other PII.
Provider-specific formats and high-entropy custom secrets remain a follow-up
for configurable DLP rules and enterprise scanning.
