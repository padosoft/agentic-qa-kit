# Architecture reference

> **Status:** stub. Full reference architecture, diagrams, and component-by-component breakdown will land in `v0.1.0` (Task 8). See `docs/internal/implementation-plan.md` §10 for the current draft.

## What this document will contain (v0.1.0)

- High-level system diagram (local mode + self-hosted multi-team)
- Component-by-component description: CLI, engine, runner, packs, adapters, server, admin, storage abstraction
- Data flow: scenario execution, event bus, finding lifecycle, replay
- Deployment topologies: single-developer laptop, CI, multi-team self-hosted, air-gap
- Capacity planning reference sizing
- Disaster recovery (backup/restore, RPO/RTO targets)

For the **enterprise reference architecture** ahead of v0.1.0, see `docs/internal/implementation-plan.md` §10 (maintainer-internal).
