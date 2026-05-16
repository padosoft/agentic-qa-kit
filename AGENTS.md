# Agentic QA Kit — Agent Guide

> This file is the **single source of truth** for any AI agent (Claude Code, Codex, Gemini, Copilot) working on this repository. Read it fully before any action.

## Repository purpose

`agentic-qa-kit` (CLI: `aqa`) is the agentic QA operating system for software projects. It transforms coding agents (Claude/Codex/Gemini/Copilot) into QA engineers guided by risk maps, invariants, scenarios, probes, oracles, and replay. See `README.md` for the product pitch and `docs/ecosystem-explained.md` for the deep introduction.

## Implementation plan

The full enterprise blueprint and execution plan is committed in:

```text
docs/internal/implementation-plan.md
```

It is **maintainer-internal** (currently Italian; an English contributor-facing summary lives in `README.md` and individual ADRs). Agents and contributors should read it for the macro-task definitions and the deep design rationale.

If context is missing, read in order:

1. `docs/PROGRESS.md` — current task state, last actions, next step
2. `docs/LESSON.md` — accumulated lessons, gotchas, fix recipes
3. `docs/RULES.md` — hard rules (UI/UX, code style, security, testing)
4. `docs/adr/` — architecture decisions
5. `docs/internal/implementation-plan.md` — full blueprint

## Operating rules (HARD)

Process and stack constraints that apply to **every** task and PR. Non-negotiable unless changed via PR to this file.

### Stack defaults

- **Runtime tier 1:** Bun (latest stable, ≥ 1.x). Use `bun` / `bunx` everywhere by default.
- **Runtime tier 1:** Node 22 LTS as fallback. Code must remain Node-compatible (no Bun-only APIs outside `packages/kit/src/bun-specific/`).
- **Language:** TypeScript strict (`"strict": true`, `"noUncheckedIndexedAccess": true`).
- **Module system:** ESM only (`"type": "module"`).
- **Monorepo:** Bun workspaces. Internal packages live under `packages/*`. Packs publishable separately under `packs/*` (npm-publishable starting v0.4).
- **Lint/format:** Biome (single config at root).
- **Test unit:** `bun:test` for packages that target Bun primarily; Vitest where Node compatibility must be verified. Coverage threshold: ≥ 80% on new code.
- **E2E UI:** Playwright (Chromium minimum; WebKit + Firefox on CI when feasible).
- **API HTTP:** Hono (for `agentic-qa-kit-server`, when extracted).
- **DB local:** SQLite via `bun:sqlite` or `better-sqlite3` (behind storage abstraction).
- **DB self-hosted (future):** Postgres ≥ 16.
- **State client (admin):** Zustand + TanStack Query.
- **UI:** React 19 + Vite 6 + Tailwind 4 + shadcn/ui (Radix-based).

### Security & secrets

- **Never log secrets.** Pre-write redaction is mandatory on any artifact (logs, screenshots, findings, replay scripts) that may carry env values, tokens, API keys, JWT, PAN, CVV, IBAN, PII.
- **Never commit secrets.** `.env*` files are gitignored. Use `.env.example` with placeholder values.
- **Never weaken sandbox** to make a test pass. Tool-call budgets, egress allowlists, and resource limits are guardrails, not friction to bypass.
- **Pack execution:** any pack including `scripts/` runs only with explicit user approval. Document in PR what the script does and why.

### UI/UX (when work touches admin panel)

- Dense layouts. Tables ≤ 36px row height. Moderate padding.
- **No card nesting** (a `Card` inside a `Card` is a defect).
- **Border radius ≤ 8px** uniformly.
- **Palette:** neutral (slate/zinc) + status accents (emerald success, amber warning, rose danger, sky info, violet AI-generated).
- **Inline SVG** for custom icons; **Lucide React** for the rest.
- **Every icon-only button** needs an accessible label and tooltip/title.
- **No overflow** at desktop standard (1280px), tablet landscape (1024px), and 125% zoom.
- **Dark mode mandatory** from day 1 (Tailwind class strategy).
- **Empty states**, **loading skeletons** (no generic spinners), **error states** must be designed explicitly.

### Documentation & changelog

- Update `docs/PROGRESS.md` after every meaningful work increment (sub-task done, blocker hit, decision made).
- Update `docs/LESSON.md` whenever something non-obvious is discovered — especially after **Copilot review iterations** that surface patterns worth remembering.
- Architectural decisions go in `docs/adr/NNN-slug.md` using the template.
- Every new package needs a `README.md` with: badges, TOC, features, **junior-friendly step-by-step setup**.

## Branch and PR loop (NON-NEGOTIABLE)

### Branch structure

```text
main                              ← protected, stable, deploy-ready
└── task/<macro-slug>             ← one branch per macro task
    ├── task/<macro-slug>/<sub>   ← one branch per sub-task
    └── ...
```

- Open the macro branch from up-to-date `main` at the start of the macro task.
- Open every sub-branch from the current macro branch.
- Sub-task PR targets the macro branch. Macro-task PR targets `main`.

### Validation loop (run on every PR — sub or macro)

1. **Local gates green:**
   - `bun install`
   - `bun run typecheck` (or per-package equivalent)
   - `bun run lint`
   - `bun test` (unit + integration)
   - `bun run build`
   - If UI touched: `bunx playwright test`
2. **Push and open PR via `gh`:**
   ```bash
   gh pr create --base <target-branch> --title "..." --body "..."
   ```
3. **Assign Copilot as reviewer.** First try:
   ```bash
   gh pr edit <pr-number> --add-reviewer copilot-pull-request-reviewer
   ```
   If that fails because `gh` queries PR project items and the token lacks `read:project`, use the GraphQL workaround (documented in `product_image_discovery_admin/AGENTS.md`):
   ```powershell
   $query = @'
   mutation RequestReviewsByLogin($pullRequestId: ID!, $botLogins: [String!], $union: Boolean!) {
     requestReviewsByLogin(input: {pullRequestId: $pullRequestId, botLogins: $botLogins, union: $union}) {
       clientMutationId
     }
   }
   '@
   gh api graphql -f query="$query" -F pullRequestId='<PR_NODE_ID>' -F botLogins[]='copilot-pull-request-reviewer[bot]' -F union=true
   ```
   The REST `reviewers[]=copilot` endpoint is **not equivalent** and may silently no-op.
   If both API paths leave `reviewRequests` empty, request Copilot review manually from the PR sidebar. **Do not substitute another reviewer or skip review** unless the user explicitly asks.
4. **Wait** for CI green AND Copilot comments. Use `gh pr view <pr> --json statusCheckRollup,reviews,comments` to poll.
5. **If green and no blockers** → squash-merge with `gh pr merge --squash --delete-branch`.
6. **If red or there are comments:**
   a. Fix locally
   b. Re-run local gates
   c. `git push` (creates a new commit on the same branch)
   d. Re-request Copilot review: `gh pr review-rerequest` or via GraphQL
   e. Go to step 4
7. **Only when fully green** is the sub-task done. **Then** move to next sub-task.

### Definition of Done

A task (sub or macro) is **not done** until **all** of these are true:

1. Goal stated explicitly in the PR body
2. Implementation complete per the sub-task spec in the plan
3. **Guardrails:**
   - Unit tests for every new non-trivial file (≥ 80% coverage on new code)
   - Integration tests for every cross-package boundary
   - **If UI/UX is touched:** Playwright scenarios for every user-visible interaction (form submit, click, navigation, drag/drop)
   - If only code/CLI: no Playwright required, only unit + integration
4. **Documentation:**
   - Package README updated (badges, TOC, features, junior-friendly setup)
   - `docs/PROGRESS.md` updated with current state and next step
   - `docs/LESSON.md` updated with non-obvious discoveries (always after Copilot review iterations)
   - ADR written for any architectural decision
5. **CI green** (all jobs in `.github/workflows/ci.yml`)
6. **Copilot review processed** (no blockers, all comments resolved or explicitly rejected with motivation)
7. **PR merged** (squash by default)

## Sub-agent context handoff

When spawning a sub-agent for parallel work, or when starting a new session:

**Always pass in the prompt:**
- The contents of `AGENTS.md` (this file)
- The last entry of `docs/PROGRESS.md`
- The last 5 entries of `docs/LESSON.md`
- The branch you are on (`git rev-parse --abbrev-ref HEAD`)

**On return, the sub-agent must:**
- Write any non-obvious discovery to `docs/LESSON.md`
- Update `docs/PROGRESS.md` with what it accomplished and what is the next sub-task

## Self-resume protocol

When a session is interrupted and resumed:

1. `cat docs/PROGRESS.md` (last 50 lines)
2. `tail -n 100 docs/LESSON.md`
3. `git status` + `git log --oneline -10`
4. `gh pr list --state open --json number,title,headRefName`
5. `gh pr status` for context on the active PR loop
6. Resume from the exact sub-task last in_progress

## Background agent strategy

When the user enables parallel sub-agents:

- Use the most capable model for backend/security/secrets/contracts.
- Use a smaller model for bounded UI / CSS / Vitest / Playwright slices.
- Keep **one main integrator** responsible for reviewing worker output, resolving conflicts, and running the final gates.
- Workers must have **disjoint write scopes**. Two workers must never edit the same file unless they sync.

## Current priority

See `docs/PROGRESS.md` for live state. As of bootstrap:

- **Active macro task:** Task 0 — Bootstrap governance & process docs (branch `task/bootstrap-governance`)
- **Next macro task:** Task 1 — Schemas package & core types

## Files referenced by this guide

- `docs/RULES.md` — UI/UX, security, testing rules in detail
- `docs/PROGRESS.md` — live state
- `docs/LESSON.md` — lessons learned
- `docs/adr/` — architecture decisions
- `docs/design/admin-panel-template.md` — admin UI spec
- `docs/getting-started.md` — junior onboarding
- `docs/ecosystem-explained.md` — deep introduction
- `.github/workflows/ci.yml` — CI gates
- `.github/copilot-instructions.md` — Copilot-specific copy of this guide
- `CLAUDE.md` — Claude Code copy
- `GEMINI.md` — Gemini CLI copy
