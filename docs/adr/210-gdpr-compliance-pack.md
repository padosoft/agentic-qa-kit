# ADR-210: Provider-neutral GDPR baseline pack

## Status

Accepted — 2026-09-18

## Context

The enterprise pack roadmap called for privacy-domain coverage, but a generic
“GDPR compliant” claim would be unsafe. Legal basis, retention, processors,
identity proofing, deadlines and cross-system deletion cannot be inferred from
an HTTP fixture.

## Decision

Ship `pack-compliance-gdpr` as an opt-in, provider-neutral baseline. It defines
risks and executable scenario contracts for DSAR access, consent withdrawal and
erasure. The endpoint paths and subject fixture are explicit placeholders that
must be adapted to a seeded non-production tenant. The pack is not enabled by
default and its README states the evidence boundary.

## Consequences

Teams get a reviewable starting point and can run deterministic journeys
against their own privacy API. A passing pack proves only the observed SUT
contract; it is not a legal compliance certification or proof of propagation
to processors, backups, analytics or downstream systems.
