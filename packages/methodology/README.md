# @aqa/methodology

Maps `agentic-qa-kit` risks to STRIDE / FMEA / OWASP — the methodology layer
auditors and architects expect (Task 21).

- `strideOf(risk)` — STRIDE categories inferred from `risk.category`.
- `fmeaScore(risk, detection?)` — RPN = severity × occurrence × detection.
- `owaspOf(risk)` — extracts `owasp:aNN` and `owasp-agentic:aNN` from tags.
- `methodologyCheck(riskMap)` — runs all three; flags risks with no anchor
  (smell — auditors cannot trace them back to a standard catalog).
- `riskCoverage(observation)` — computes the documented weighted coverage
  score and returns `covered`, `partial`, `gap` or `stale` plus drift alerts.
- `measureRiskCoverage(input)` — derives observations from a risk map,
  scenario links and bounded run history; missing artifacts remain gaps.
