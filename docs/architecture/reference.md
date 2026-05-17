# Architecture reference

> Component map, data flow, and the contracts each piece honors. Canonical
> diagram for the rest of the docs.

## Components

```
                          +--------------------------------+
                          |           @aqa/kit             |
                          |  +--------------------------+  |
                          |  |   `aqa` CLI binary       |  |
                          |  |  init / doctor / validate|  |
                          |  +-----------+--------------+  |
                          |              |                  |
                          |  +-----------v--------------+   |
                          |  |   Programmatic API       |   |
                          |  |   profileRepo / runInit  |   |
                          |  +-----------+--------------+   |
                          +--------------+------------------+
                                         | depends on
              +--------------------------+--------------------------+
              |                          |                          |
   +----------v---------+   +------------v--------+   +-------------v-----+
   |   @aqa/schemas     |   | @aqa/pack-loader    |   |   @aqa/adapters   |
   |  Zod + JSONSchema  |   | loadPacks +         |   |  Claude / Codex / |
   |  source of truth   |   | appliesWhen         |   |  Gemini / Copilot |
   +----------+---------+   +------------+--------+   +-------------+-----+
              |                          |                          |
              | feeds shape into         | ships seed YAMLs to      | writes per-host
              |                          v                          v
              |                  +-------------------------------------+
              |                  |             packs/*                 |
              |                  |  core / api-core / web-ui /         |
              |                  |  llm-agent / security               |
              |                  +-------------------------------------+
              |
              |  consumed by v
   +----------v-----------------------------------------------------+
   |                          @aqa/runner                            |
   |  RunLifecycle --> probes --> oracles --> FindingsWriter         |
   |                       |                                          |
   |                       +--> EventChainWriter (hash-chained jsonl) |
   +----------+-----------------------------------------------------+
              |
              |  emits v
   +----------v-----------------------------------------------------+
   |                       .aqa/runs/<id>/                           |
   |  run.json | events.jsonl | findings.jsonl | artifacts/ | logs/  |
   +--------+--------------------------------------+-----------------+
            |                                      |
            | rendered into v                      | visualised by v
   +--------v-----------+                    +-----v----------+
   |   @aqa/reporter    |                    |   @aqa/admin   |
   |  markdown / json   |                    |  Vite + React  |
   |  replay artifacts  |                    |  read-only     |
   +--------------------+                    +----------------+
```

## Data flow (smoke profile, one scenario)

1. **Project profiling** — `profileRepo(root)` reads `package.json` + filesystem
   signals to detect runtime, framework, DB, SUT type, LLM SDK, test runner.
2. **Pack discovery** — `loadPacks(packs/)` returns every manifest;
   `appliesWhen(manifest, profile)` filters to the packs that match.
3. **Scenario selection** — applicable packs contribute their `scenarios:` list.
4. **For each scenario** — `runScenario()` orchestrates the probe → oracle
   → finding loop. Every step appends a hash-chained event.
5. **Reporters** — `renderMarkdown` / `renderJson` produce human and machine
   reports. `buildReplayArtifacts(finding, scenario)` emits the per-finding
   `repro.sh` / `repro.curl` / `repro.playwright.ts`.

## Contracts each layer owns

| Layer              | Owns                                                                  |
|--------------------|-----------------------------------------------------------------------|
| `@aqa/schemas`     | Every persisted data shape, hash chain + determinism gating           |
| `@aqa/kit`         | `aqa` binary, project profiler, `.aqa/*` scaffolding                  |
| `@aqa/pack-loader` | Pack discovery and the `applies_when` predicate                       |
| `@aqa/adapters`    | Per-agent-host instruction file + skill rendering                     |
| `@aqa/runner`      | Lifecycle, events.jsonl, findings.jsonl, oracle evaluation            |
| `@aqa/reporter`    | Markdown/JSON reports + 3-level replay artifacts                      |
| `@aqa/admin`       | Read-only viewer over `.aqa/runs/*`                                   |
| `packs/*`          | Risk taxonomies, scenarios, oracles, probes, templates                |

## Hard invariants

- **Determinism contract** — `Finding.status = 'verified'` requires
  `reproducibility[verification_floor].deterministic === true` (Zod superRefine
  + JSON Schema if/then). Without it, an auditor cannot trust verified bugs.
- **Audit chain integrity** — every `Event.hash = sha256(prev_hash ‖ canonical(rest_of_event))`.
  Tests verify the chain end-to-end.
- **Schema-driven** — every layer that produces `.aqa/*` content validates the
  output against `@aqa/schemas` before writing. There is no "trust me" data
  flow.

## What changes in v0.2 / v0.3

The implementation plan (`docs/internal/implementation-plan.md`) lists the
tasks that follow v0.1.0: determinism contract refinements, hard cost
governance, container sandbox default, Postgres backend, SSO/OIDC, pack
signing, on-prem LLM adapters. The component map above stays the same; each
new task adds a clearly-scoped capability behind a feature flag.
