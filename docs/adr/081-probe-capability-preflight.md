# ADR-081 — Probe capability preflight

## Status

Accepted — 2026-09-17

## Decision

`runScenario()` accepts an optional `supportedProbeKinds` declaration. When it
is supplied, the runner validates both scenario steps and cleanup probes before
executing any of them. Unsupported probes are recorded as failed execution
evidence, oracle evaluation continues for diagnostic output, cleanup is not
attempted, and no security finding is emitted.

## Rationale

Agentic and ecommerce packs increasingly mix HTTP, browser, SQL, shell and
model-evaluation probes. A driver that silently supports only one subset can
otherwise create partial side effects or make a missing capability look like a
valid negative assertion. Preflight turns that ambiguity into an explicit
coverage gap before the SUT is changed.

## Limits

The declaration is an integration contract, not proof that a driver implements
the capability correctly. Each concrete browser/SQL/shell/LLM driver still
needs live complete-journey tests, sandbox policy and provider-specific evidence.
