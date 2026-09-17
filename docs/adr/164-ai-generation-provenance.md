# ADR-164: Preserve provenance for AI-generated scenarios

## Status

Accepted

## Context

AI-generated scenarios are held behind a human review queue, but without model
and prompt provenance a reviewer cannot later explain which generation produced
an approved draft. Persisting raw prompts or model responses can also retain
secrets from source context.

## Decision

Each generated review item may carry `GenerationProvenance` containing provider,
model, optional model-version hash, risk ID, and SHA-256 hashes of the
invariant, exact prompt and raw response. The queue stores hashes and metadata,
not the raw prompt/response. Generated scenarios receive deterministic queue IDs
and valid fallback titles before schema validation.

## Evidence and boundary

Generator tests pass 6/6 locally, including provenance and minimal-response
regressions. The queue still requires explicit human approval; hashes do not
replace content review, source-aware risk analysis or model/provider trust
configuration.
