# Getting started — 15 minutes

> The fastest path from a fresh checkout to a first agentic QA run.
> Audience: a junior contributor who has never seen the kit before.

## 0. Pre-requisites (2 min)

| Tool         | Version       | Check command                |
|--------------|---------------|------------------------------|
| Bun          | ≥ 1.3.0       | `bun --version`              |
| Node         | ≥ 22 LTS      | `node --version`             |
| Git          | any modern    | `git --version`              |
| GitHub CLI   | optional      | `gh --version`               |

> Windows users: PowerShell 7+ is the supported shell. WSL also works.

## 1. Install the kit in your project (3 min)

```bash
cd path/to/your/project
bun add -D @aqa/kit @aqa/schemas
```

> Until v0.1.0 publishes to npm, consume the kit via this monorepo's workspace:
> `"@aqa/kit": "workspace:*"`.

## 2. Bootstrap `.aqa/` (1 min)

```bash
bunx aqa init
```

This writes four files (non-destructive — existing files are skipped):

```
.aqa/
├── project.yaml      # project name, runtime, framework, DB, SUT type
├── risk-map.yaml     # one starter risk; replace with the ones that matter
├── profiles.yaml     # `smoke` and `release-gate` profiles, both orchestrator-mode
└── testing.md        # human-readable rationale for the QA conventions
```

Open each file and tailor them to your SUT. **The risk map is the heart of
the kit — generic risks produce generic findings.**

## 3. Verify the install (1 min)

```bash
bunx aqa doctor      # ✓/⚠/✗ checklist
bunx aqa validate    # schema-check .aqa/* against @aqa/schemas (CI-safe)
```

## 4. Install agent instruction files (2 min)

> `aqa install-agent-files` lands with the Task 4 follow-up. Until then, copy
> the templates from `packages/adapters/src/*.ts` into your repo manually
> (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.github/copilot-instructions.md`).

## 5. Define one real risk (3 min)

Replace the placeholder in `.aqa/risk-map.yaml`:

```yaml
- id: r-token-replay
  category: auth
  title: Tokens remain valid past rotation
  severity: critical
  likelihood: possible
  invariants:
    - id: inv-token-rotation
      statement: Old tokens become invalid within 60 seconds of rotation.
```

A good invariant is **one sentence**, **falsifiable**, and **independent of
implementation**.

## 6. Run the smoke profile (3 min)

> Full `aqa run --profile smoke` lands with the Task 5 HTTP-probe-driver
> follow-up. Until then, exercise the runner programmatically:

```ts
import { runScenario, EventChainWriter } from '@aqa/runner';

const events = new EventChainWriter('.aqa/runs/demo/events.jsonl');
const result = await runScenario({
  scenario, run_id: 'demo',
  probeRunner: async (p) => ({ probe_id: p.id, status: 401 }), // mocked
  events,
});
console.info(result.finding ? 'FAIL' : 'PASS');
```

The runner appends a hash-chained event log under `.aqa/runs/demo/` and emits
a Finding when an oracle fails. That Finding is the smallest unit your CI gate
will fail on.

## Where to go next

- **`docs/methodology/agentic-qa.md`** — the Risk × Invariant × Probe × Oracle
  methodology, in long form.
- **`docs/ecosystem-explained.md`** — every concept in the kit, with a worked
  example.
- **`docs/architecture/reference.md`** — the component map and data flow.
- **`docs/design/admin-panel-template.md`** — the full admin UI spec.
- **`docs/RULES.md`** — the hard rules every contribution must obey.
- **`docs/adr/`** — architecture decisions (start with ADR-001).

When you hit something the docs don't cover, file an issue. The kit is
junior-friendly **on purpose**.
