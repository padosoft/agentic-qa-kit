# @aqa/schemas

[![npm version](https://img.shields.io/npm/v/@aqa/schemas?label=npm)](https://www.npmjs.com/package/@aqa/schemas)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](../../LICENSE)
[![schema version](https://img.shields.io/badge/schema-v1-purple.svg)](./schemas/v1)

> **Single source of truth for every data shape in `agentic-qa-kit`.**
> Zod runtime validators, generated JSON Schemas (Draft 2020-12), and TypeScript types — all derived from the same definitions so they never drift.

## Table of contents

- [What's inside](#whats-inside)
- [Install](#install)
- [Usage](#usage)
- [Schemas in v1](#schemas-in-v1)
- [Determinism contract (Finding)](#determinism-contract-finding)
- [Hash-chained audit (Event)](#hash-chained-audit-event)
- [Development](#development)

## What's inside

| Layer | Artifact | Purpose |
|---|---|---|
| Source of truth | `src/*.ts` (Zod) | Runtime validation + TS types |
| Derived | `schemas/v1/*.schema.json` (JSON Schema 2020-12) | LSP autocompletion, third-party validators, language ports |
| Derived | `dist/*.d.ts` | TypeScript types for downstream packages |
| Test data | `fixtures/{valid,invalid}/` | Golden examples used by the test suite |

## Install

```bash
bun add @aqa/schemas
```

## Usage

```ts
import { Finding, Scenario, SCHEMA_VERSION } from '@aqa/schemas';

console.log(SCHEMA_VERSION); // "1"

const result = Finding.Finding.safeParse(someJson);
if (!result.success) {
  console.error('finding rejected:', result.error.issues);
}
```

Each namespaced export bundles the Zod validator(s) for that domain. To work with the JSON Schema directly (e.g. for editor support):

```jsonc
{
  "$schema": "./node_modules/@aqa/schemas/schemas/v1/scenario.schema.json"
}
```

## Schemas in v1

| Domain | Source | Description |
|---|---|---|
| `Project` | `src/project.ts` | `.aqa/project.yaml` shape |
| `Profile` / `ProfilesFile` | `src/profile.ts` | `.aqa/profiles.yaml` shape, dual-mode `execution_mode`, LLM budgets |
| `RiskMap` | `src/risk-map.ts` | Risk × invariant taxonomy |
| `Scenario` | `src/scenario.ts` | Probe + oracle definitions |
| `Finding` | `src/finding.ts` | Bug report with 3-level reproducibility + confidence components |
| `Event` | `src/event.ts` | Hash-chained audit event |
| `Run` | `src/run.ts` | Per-run manifest + totals + LLM cost rollup |
| `PackManifest` | `src/pack-manifest.ts` | Pack manifest with `applies_when` predicates |

## Determinism contract (Finding)

`Finding` enforces the three-level reproducibility contract from the implementation plan:

```ts
{
  verification_floor: 'bug_level' | 'scenario_level' | 'agent_level',
  reproducibility: {
    bug_level?:      { deterministic, attempts, successes, artifact_path? },
    scenario_level?: { deterministic, attempts, successes, seed? },
    agent_level?:    { deterministic, attempts, successes, model_pinned? },
  },
  confidence_components: {
    oracle_agreement?, agent_self_reported?, judge_ensemble?,
    replay_success_rate?, historical_fp_rate?
  }
}
```

A `status: 'verified'` finding **must** have a deterministic floor at the declared `verification_floor`. The validator enforces this.

## Hash-chained audit (Event)

`Event` requires `seq`, `prev_hash` and `hash` (SHA-256 hex). The runner appends events to `events.jsonl` with each `hash = sha256(prev_hash || canonical(payload))`, giving the audit log the same WORM properties an SOC2 auditor expects.

## Development

```bash
bun install
bun run --filter @aqa/schemas build
bun run --filter @aqa/schemas test
```

`build` regenerates `schemas/v1/*.schema.json` from the Zod sources via `scripts/emit-json-schemas.mjs`. **Never hand-edit** the JSON Schema files — edit the Zod sources and run `bun run build`.

## License

Apache-2.0 © Padosoft
