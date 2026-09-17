# ADR-193: Fail-closed agent semantic evaluation and calibration

## Context

An LLM judge score is not evidence by itself. A single judge can be biased,
models can agree for the wrong reason, and an uncalibrated `confidence` value
cannot support a release decision.

## Decision

`@aqa/runner` provides `evaluateAgentTrials()` for already-produced opaque
verdicts. A policy requires a minimum judge count and trial count, optionally
requires distinct model identities, applies a score threshold, and returns
`inconclusive` when an ensemble is too small or disagrees. It aggregates only
bounded scores and model IDs; private rationales are represented by an
optional SHA-256 digest.

`calibrateAgentJudges()` evaluates a human-reviewed gold corpus with Brier
score and expected calibration error, including bounded probability bins. It
does not call a provider or persist judge text. Provider invocation,
prompt/version pinning and human adjudication remain host responsibilities.

## Consequences

Release gates can distinguish pass, fail and insufficient semantic evidence.
Teams can measure whether confidence values are meaningful before using them
operationally. The local contract is deterministic; live provider quality and
the representativeness of the gold corpus still require deployment evidence.
