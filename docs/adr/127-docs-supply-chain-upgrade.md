# ADR-127: Keep the documentation toolchain advisory-free

**Status:** Accepted  
**Date:** 2026-09-17

## Context

The documentation site has an independent `package-lock.json`. Its audit was
reporting five high and one moderate advisory through the search/Markdown and
Hugging Face native dependencies, even while the Bun workspace audit was clean.
Treating the root audit as proof of repository-wide safety would leave the
separately installed documentation build outside the security boundary.

## Decision

Upgrade the documentation toolchain to the current compatible releases:
`@docmd/core` 0.9.x, `docmd-search` 0.1.5,
`@huggingface/transformers` 4.3.x, and `onnxruntime-node` 1.30.x. Regenerate
the npm lockfile and run `npm ci --ignore-scripts`, the docs check/build, and
`npm audit` from `docs-site` in CI/local release verification.

## Consequences

- The independent docs dependency graph is currently at zero npm audit
  vulnerabilities.
- The root Bun audit and docs npm audit are separate gates and must remain so.
- The build still emits a non-security configuration warning about an unknown
  top-level `description` property; that is follow-up documentation-tooling
  cleanup, not an ignored security finding.
