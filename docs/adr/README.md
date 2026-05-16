# Architecture Decision Records

This directory holds Architecture Decision Records (ADRs) for `agentic-qa-kit`. An ADR captures a single, significant architectural decision: the context, the decision, the consequences. Decisions that affect users, contributors, or operators in production deserve an ADR.

## When to write an ADR

Write one when you:

- Choose between two or more viable approaches (storage backend, queue technology, runtime, framework, schema format).
- Introduce a binding constraint (security policy, sandbox model, supply-chain rule).
- Adopt a process governance rule that affects every contributor (validation loop, branch strategy, commit style).
- Reverse or supersede a previous ADR (link from the old one).

Do **not** write an ADR for routine implementation choices (variable names, file layout in a single feature, library version bumps).

## Format

Each ADR is a markdown file named `NNN-slug.md` (zero-padded number, kebab-case slug). Use the template below.

```markdown
# NNN — <decision title>

- **Status:** proposed | accepted | superseded by ADR-XXX | deprecated
- **Date:** YYYY-MM-DD
- **Deciders:** <names or roles>
- **Tags:** <e.g. determinism, security, runtime>

## Context

Describe the forces at play: the problem, the constraints, the assumptions, the alternatives considered. Be concrete with file paths, version numbers, vendor names.

## Decision

State the decision in active voice. One paragraph. No hedging.

## Consequences

### Positive
- ...

### Negative / trade-offs
- ...

### Neutral / follow-ups
- ...

## Alternatives considered

- **Option A:** brief description and why rejected.
- **Option B:** brief description and why rejected.

## References

- Plan section if relevant
- Related ADRs (links)
- External links if essential
```

## Index

| # | Title | Status | Date |
|---|---|---|---|
| 001 | Execution mode (agent vs orchestrator) | _proposed_ | _pending_ |
| 002 | Oracle chain & LLM-as-judge policy | _proposed_ | _pending_ |
| 003 | Storage abstraction (SQLite local, Postgres self-hosted) | _proposed_ | _pending_ |
| 004 | Schema-first (JSON Schema + OpenAPI + AsyncAPI as source of truth) | _proposed_ | _pending_ |
| 005 | Runtime targets (Bun tier-1 + Node tier-1) | _proposed_ | _pending_ |
| 006 | Sandbox model (container-per-scenario default) | _proposed_ | _pending_ |
| 007 | Pack supply chain (sigstore signing + SBOM + allowlist) | _proposed_ | _pending_ |
| 008 | Cost governance (per-org/project/profile budgets, hard kill-switch) | _proposed_ | _pending_ |
| 009 | Determinism contract (3-level replay, bug-level required for verified) | _proposed_ | _pending_ |
| 010 | Audit log (hash-chained, WORM-exportable, append-only RBAC) | _proposed_ | _pending_ |

(ADRs 011-020 listed in the durable plan; will be added as the architecture is finalized.)
