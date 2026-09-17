# ADR-176: Aggregate provider-neutral commerce journeys as one gate

## Context

The commerce package had individual checkout, refund, tax, shipping and
webhook verifiers, but callers had to compose them manually. That made it easy
to run only the happy checkout path or to accidentally treat an unsupported
provider capability as an overall pass.

## Decision

Add `verifyCommerceJourneySuite()`. Checkout and refund are required inputs;
tax, shipping and webhook journeys are opt-in. The suite prefixes evidence
steps with their journey name and derives one fail-closed outcome: any error or
failure wins, unsupported remains unsupported, and only all requested journeys
passing with complete evidence produce `pass`.

## Boundary

The suite is a provider-neutral orchestration contract, not proof of a live
Stripe/Adyen/tax/3PL integration. Adapter contract tests and complete external
provider journeys remain required before production sign-off.
