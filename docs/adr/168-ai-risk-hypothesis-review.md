# ADR-168: AI risk hypotheses require a separate human review queue

## Context

Source-aware discovery is deterministic and explainable, but it cannot cover
all project-specific business and security hypotheses. An LLM can suggest
additional candidates, yet model output is untrusted and must not silently
become an active `RiskMap`.

## Decision

Add `proposeRisks` and `RiskReviewQueue` to `@aqa/generator`. The generator
validates candidates against `RiskMap.Risk`, redacts generated content with
the shared DLP policy, records provider/model and SHA-256 hashes of the prompt
and response, and stores only pending review items. A named reviewer must
explicitly approve or reject each item.
Terminal transitions are immutable, and the API has no `RiskMap` mutation path.

## Evidence and boundary

Generator queue tests cover valid proposals, provenance, redaction, malformed
JSON, anonymous approval rejection and approval activation. This proves the local
governance contract only; it does not prove LLM quality, coverage, prompt
security, reviewer identity enforcement in a remote service, or production
RiskMap persistence.
