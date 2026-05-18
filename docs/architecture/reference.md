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

## What changed in v0.2 → v1.2

The 24-task roadmap is closed (v1.0 GA). The component map above stayed
stable; each new package landed behind a clear seam:

- **v0.2** — `@aqa/cost` (budget cap), `@aqa/sandbox` (process + container),
  determinism contract refinements + `aqa verify <finding-id>`.
- **v0.3** — `@aqa/store` (Memory + Postgres scaffold), `@aqa/auth` (OIDC +
  RBAC), `@aqa/pack-scanner` (signature + ruleset), `@aqa/llm-adapters`
  (Fixture + scaffold for live providers).
- **v0.4** — `@aqa/admin-core` (OptimisticEditor + conflict detection),
  `@aqa/generator` (ReviewQueue with terminal-state guards).
- **v0.5** — `@aqa/server` (framework-agnostic routing table + RunnerQueue),
  `@aqa/clustering` (signatureOf + clusterFindings).
- **v0.6** — `@aqa/methodology` (STRIDE / FMEA / OWASP mapping),
  `deploy/helm` chart + `deploy/terraform` + `scripts/air-gap-install.sh`.
- **v1.0** — `@aqa/compliance` (SOC2 / ISO controls catalog +
  `aqa-audit-verify` CLI).
- **v1.1** — Full Helm chart (runner StatefulSet, Ingress, NetworkPolicy,
  Postgres subchart), three example targets (Bun, Next.js, Laravel).
- **v1.2** — Admin SPA wired (Tailwind 4 + TanStack Router + Query + 12
  screens including audit-chain verification in-browser via Web Crypto).

## Where the diagram lives in code

| Layer in diagram | Path | Notes |
|---|---|---|
| `aqa` CLI | `packages/kit/dist/cli/aqa.js` | Bin entry; commands in `packages/kit/src/commands/` |
| Programmatic API | `packages/kit/src/index.ts` | `profileRepo`, `runInit` exports |
| Schemas | `packages/schemas/src/*.ts` + `packages/schemas/schemas/v1/*.json` | Zod + JSON Schema mirror |
| Pack loader | `packages/pack-loader/src/index.ts` | `applies_when` evaluator |
| Adapters | `packages/adapters/src/*.ts` | `render(ctx)` per agent host |
| Runner | `packages/runner/src/*.ts` | `RunLifecycle`, `EventChainWriter`, oracles |
| Reporter | `packages/reporter/src/*.ts` | Markdown + JSON + repro artifacts |
| Admin | `packages/admin/src/*` | Vite + React 19 + TS strict |
| Server | `packages/server/src/api.ts` | `makeApi()` returns routing table |
| Compliance | `packages/compliance/src/*.ts` | `verifyEventChain`, `CONTROL_MAPPINGS` |

## Adjacent docs

- [`docs/security/threat-model.md`](../security/threat-model.md) — STRIDE
  catalog with current mitigations.
- [`docs/methodology/agentic-qa.md`](../methodology/agentic-qa.md) — the
  Risk / Invariant / Probe / Oracle methodology.
- [`docs/compliance/soc2-iso-mapping.md`](../compliance/soc2-iso-mapping.md) —
  feature → SOC2 TSC + ISO Annex A mapping.
