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
bun add -D agentic-qa-kit
```

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

```bash
bunx aqa install-agent-files --targets claude,codex,gemini,copilot
```

This generates agent-specific instruction files and skills in your repo.

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

```bash
bunx aqa run --profile smoke
```

Optional immediate report:

```bash
bunx aqa report
```

Then open the admin panel:

```bash
bun --filter @aqa/admin dev
```

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
