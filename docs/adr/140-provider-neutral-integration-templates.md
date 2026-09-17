# ADR-140: Provider-neutral integration templates

**Status:** Accepted  
**Date:** 2026-09-17

## Context

Slack, Teams, Jira and PagerDuty accept different payload shapes, but their
delivery guarantees, tenant boundaries and secret handling must remain shared.
Embedding vendor payloads in API handlers creates drift and makes tests call
external systems.

## Decision

`@aqa/integrations` exposes deterministic renderers for the four provider
families. They transform a typed notification into the provider payload only;
credentials, routing keys, retries, signing and transport authorization remain
outside the renderer and are handled by the durable webhook queue.

## Consequences

- Provider adapters can be tested as pure functions and upgraded independently.
- No renderer may include secret material or provider credentials.
- Real provider journeys, API-version compatibility and destination-side
  idempotency remain deployment evidence, not claims made by the templates.
