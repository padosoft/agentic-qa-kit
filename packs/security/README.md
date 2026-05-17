# @aqa/pack-security

OWASP Top 10 (web) and OWASP Agentic Top 10 (LLM apps) as seed risks.

**Coverage as of v0.1.0** is intentionally partial — the goal of this pack at this milestone is to
seed the taxonomy, not to claim audit-grade completeness:

- Web OWASP Top 10 (2021): A01, A02, A03, A04, A05, A07, A08, A09, A10. **A06 (Vulnerable and
  Outdated Components)** lands in v0.1.1.
- OWASP Agentic Top 10: A01 (Prompt Injection), A02 (Tool/Function Abuse), A03 (Data Exfiltration).
  Remaining items (A04–A10) land in v0.1.1.

Applies when the project's profile tags include `security` or `release-gate`. Scenarios for each
risk are added in the runner-and-replay pass — this pack ships only the risk taxonomy at v0.1.0.
