# Agentic QA methodology

> **Status:** stub. The full methodology paper (≥ 8,000 words) will land in `v0.1.0` (Task 8). Until then, `docs/ecosystem-explained.md` covers the mental model and `docs/internal/implementation-plan.md` covers the deep design rationale.

## What this document will contain (v0.1.0)

- The 7-word mental model (Risk → Invariant → Scenario → Probe → Oracle → Finding → Replay), each concept treated in depth with worked examples
- Risk discovery frameworks: STRIDE for security, FMEA for reliability, OWASP Top 10 (app + agentic) for vulnerability classes, attack trees for adversarial security
- Oracle taxonomy: deterministic vs semi-deterministic vs LLM-judge, the fallback chain (ADR-002), calibration methodology, inter-rater reliability
- Three-level replay contract (bug / scenario / agent) and what verifiability means at each level (ADR-009)
- Coverage measurement, drift detection, false-positive rate management
- Findings dedup, root-cause clustering, Bayesian prioritization
- The bug → fix → verify-fix → close loop, integrated with PR workflows
- Anti-patterns to avoid (one section per anti-pattern from the implementation plan)

For the **methodology synthesis** ahead of v0.1.0, see `docs/ecosystem-explained.md` (concepts) and `docs/internal/implementation-plan.md` §3 + §8 (deep rationale).
