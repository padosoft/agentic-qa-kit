# Threat model — STRIDE applied to AQA

> **Status:** stub. Full STRIDE analysis (50+ threats with mitigations) will land in `v0.1.0` (Task 8). See `docs/internal/implementation-plan.md` §11 for the current synthesis.

## What this document will contain (v0.1.0)

- Trust boundaries diagram (user, runner, server, SUT, LLM vendor, secrets store, audit store)
- For each STRIDE category (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege): threat catalogue with severity, likelihood, current mitigation, residual risk
- Special focus: agentic-specific threats (prompt injection via tool result poisoning, pack supply chain, LLM exfiltration, cost-based DoS)
- Defensive architecture: sandbox model (ADR-006), pack signing (ADR-007), audit log (ADR-010), cost kill-switch (ADR-008), determinism contract (ADR-009)

For the **threat model synthesis** ahead of v0.1.0, see `docs/internal/implementation-plan.md` §11 (maintainer-internal).
