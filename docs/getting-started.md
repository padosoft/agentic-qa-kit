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

## 1. Authenticate to GitHub Packages (2 min, one-time)

The kit is published as `@padosoft/agentic-qa-kit` on GitHub Packages. Public packages on GH Packages still require auth — create a personal access token (PAT) once and tell `bun`/`npm` how to use it.

1. Create a PAT at <https://github.com/settings/tokens> with scope **`read:packages`** (that's the only one you need to install).
2. Add this `.npmrc` to your project root:

```ini
@padosoft:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

3. Export the token in your shell (`~/.zshrc`, `~/.bashrc`, or the equivalent on Windows):

```bash
export GITHUB_TOKEN=ghp_XXXXXXXXXXXXXXXXXXXX
```

> For CI, set `GITHUB_TOKEN` as a workflow/runner secret — never commit it.

## 2. Install the kit in your project (1 min)

```bash
cd path/to/your/project
bun add -D @padosoft/agentic-qa-kit
```

The CLI is the only thing that gets installed — a single bundled `cli.cjs` (~460 KB) with all `@aqa/*` workspace deps inlined. The admin SPA and the 5 bundled packs ride along inside the same tarball.

## 3. Bootstrap `.aqa/` (1 min)

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

Open each file and tailor them to your SUT. **The risk map is the heart of the kit — generic risks produce generic findings.**

## 4. Verify the install (1 min)

```bash
bunx aqa doctor      # ✓/⚠/✗ checklist
bunx aqa validate    # schema-check .aqa/* against @aqa/schemas (CI-safe)
```

## 5. Install agent instruction files (2 min)

```bash
bunx aqa install-agent-files --targets claude,codex,gemini,copilot
```

This generates `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.github/copilot-instructions.md` plus per-agent skills under `.claude/skills/`, `.agents/skills/`, `.gemini/skills/`, and `.github/skills/`.

Flags worth knowing:
- `--force` — overwrite existing files (default: skip).
- `--dry-run` — preview what would change without touching disk.
- `--project-name <slug>` — override the slug embedded in the headers (default: directory name, slugified, capped at 64 chars).

## 6. Define one real risk (3 min)

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

A good invariant is **one sentence**, **falsifiable**, and **independent of implementation**.

## 7. Run the smoke profile (3 min)

```bash
bunx aqa run --profile smoke
```

Each run writes `events.jsonl`, `findings.jsonl`, and per-finding replay artifacts (`repro.sh`, `repro.curl`, `repro.playwright.ts`) under `.aqa/runs/<run-id>/`.

## 8. Render the report (10 sec)

```bash
bunx aqa report                       # latest run, both formats
bunx aqa report --run-id <id>         # explicit run
bunx aqa report --format md           # just report.md
```

Output lands inside the same run directory as `report.md` (auditor-friendly) and `report.json` (machine-readable, same shape the admin UI consumes).

## 9. Boot the admin (10 sec)

```bash
bunx aqa admin
```

Opens `http://127.0.0.1:5173`. The SPA + API run in one process and the in-memory store is auto-seeded from `.aqa/runs/`. Browse runs, drill into findings, replay deterministically, verify the hash-chained audit log. `Ctrl-C` to stop.

| Flag | Effect |
|---|---|
| `--port <n>` | listen on a specific port (default 5173; 0 = OS-assigned) |
| `--host <h>` | bind host (default `127.0.0.1`; use `0.0.0.0` to expose on LAN) |

## Where to go next

- **`docs/methodology/agentic-qa.md`** — the Risk × Invariant × Probe × Oracle methodology, in long form.
- **`docs/ecosystem-explained.md`** — every concept in the kit, with a worked example.
- **`docs/architecture/reference.md`** — the component map and data flow.
- **`docs/PACK-AUTHORING.md`** — write your own pack (`aqa pack new <slug>`).
- **`docs/design/admin-panel-template.md`** — the full admin UI spec.
- **`docs/RULES.md`** — the hard rules every contribution must obey.
- **`docs/adr/`** — architecture decisions (start with ADR-001).

When you hit something the docs don't cover, file an issue. The kit is junior-friendly **on purpose**.
