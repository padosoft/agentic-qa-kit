# Project Rules

This file is referenced by `AGENTS.md` and applies to every contributor — human or agent.

## Source of truth

- **Operating procedure & process governance:** `AGENTS.md` (root)
- **Live state:** `docs/PROGRESS.md`
- **Lessons learned:** `docs/LESSON.md`
- **Architecture decisions:** `docs/adr/`
- **Durable implementation plan:** `%USERPROFILE%\.claude\plans\qui-c-users-lopad-downloads-agentic-qa-k-ethereal-scott.md`
- **Admin panel design spec:** `docs/design/admin-panel-template.md`
- **Reference repo for conventions:** `../product_image_discovery_admin` (Laravel+React equivalent already in production)

## Implementation defaults

| Concern | Default | Notes |
|---|---|---|
| Runtime tier 1 | Bun (latest stable) | `bun`, `bunx` everywhere |
| Runtime tier 1 fallback | Node 22 LTS | Bun-only APIs only inside `packages/kit/src/bun-specific/` |
| Language | TypeScript strict | `"strict": true`, `"noUncheckedIndexedAccess": true`, ESM only |
| Monorepo | Bun workspaces | `packages/*` for code, `packs/*` for content packs |
| Lint/format | Biome | Single root config |
| Test unit | `bun:test` and Vitest | Coverage ≥ 80% on new code |
| Test e2e UI | Playwright | Chromium minimum |
| HTTP server | Hono | For `agentic-qa-kit-server` |
| Local state | SQLite (`bun:sqlite` or `better-sqlite3`) | Behind a `StoreProvider` interface |
| Self-hosted state | Postgres ≥ 16 | When server is extracted |
| Admin state client | Zustand + TanStack Query | TanStack Router for routing |
| Admin UI | React 19 + Vite 6 + Tailwind 4 + shadcn/ui | Lucide React icons |

## UI rules (admin panel)

- **Density first.** Tables ≤ 36px row height. Moderate padding.
- **No nested cards.** A `Card` inside a `Card` is a defect to fix.
- **Border radius ≤ 8px** uniformly across the app.
- **Palette:** neutral slate/zinc as base. Status accents:
  - `emerald` for success/pass
  - `amber` for warning/pending
  - `rose` for danger/fail
  - `sky` for info/neutral notification
  - `violet` for AI-generated artifacts (always visually distinct from human-authored)
- **Icons:** inline SVG for custom; Lucide React for standard. Every icon-only button needs `aria-label` and `title`.
- **Text must not overflow** at 1280px (desktop), 1024px (tablet landscape), or 125% zoom.
- **Dark mode mandatory** from day 1 (Tailwind class strategy).
- **Empty states**: always designed (never blank pages).
- **Loading**: section-specific `<Skeleton>` (never generic spinners except on global navigation).
- **Error states**: message + retry + link to debug info.

## Security rules

- **Never log secrets.** Pre-write redaction on logs, screenshots, findings, replay artifacts, audit entries.
- **Never commit secrets.** `.env*` gitignored. Provide `.env.example` with placeholders.
- **Findings/artifacts must pass DLP** before persistence: regex + entropy detection on AWS keys, JWT, email, CC, IBAN, IP, custom PII.
- **Sandbox is not optional.** Production-grade isolation (container or vm) for `security` and `release-gate` profiles. Local `dev` profile may relax.
- **Pack execution risk:** any pack carrying `scripts/` must be explicitly approved by the user. Default-deny.
- **No sanitized errors leak** raw provider payloads or stack traces to operators. Stack traces only in debug logs.

## Testing rules

Every completed sub-task should run, at minimum, the subset of:

```bash
bun install
bun run typecheck
bun run lint
bun test                  # unit + integration
bun run build
bunx playwright test      # only if UI/UX touched
```

- New non-trivial files: unit test coverage ≥ 80%.
- Cross-package boundaries: integration test.
- UI/UX work: Playwright scenarios for every user-visible interaction.
- LLM-dependent code: deterministic fixtures (record/replay) for CI; live calls only behind explicit env flag.

## Documentation rules

- Update `docs/PROGRESS.md` after every meaningful work increment.
- Update `docs/LESSON.md` whenever something non-obvious is discovered. **Always update after a Copilot review iteration** when the comment surfaced something worth remembering.
- Architectural decisions go in `docs/adr/NNN-slug.md` using the template.
- Every new package needs a `README.md` with: badges, TOC, features, **junior-friendly step-by-step setup**.
- Dated entries use `YYYY-MM-DD`.

## Review rules

- Every PR (sub or macro) **must** request Copilot Code Review. See `AGENTS.md § Branch and PR loop` for the request flow and the GraphQL fallback.
- The user can ask for additional reviewers (Codex, human) but Copilot is the baseline.
- Do not merge until CI is green AND Copilot comments are resolved or explicitly rejected with motivation.

## Code style

- ESLint/Biome enforced. Format with Biome on save.
- No `any` unless justified in comment.
- No `// @ts-ignore` / `// @ts-expect-error` without justification comment.
- No silent catch (`catch (e) {}`). Either re-throw, log structurally, or document why swallow.
- Prefer named exports over default.
- Tests use `describe`/`it` (or `test`) and `expect`. Snapshot tests only for stable structures.

## Commit message style

Conventional Commits with optional gitmoji:

```
feat(kit): add aqa init command with project profiler
fix(schemas): reject scenario YAML missing risk_id reference
docs(readme): add quickstart for first-time users
chore(ci): bump actions/setup-node to v4
test(adapters): cover Gemini commands toml generation
refactor(runner): extract oracle registry from runner core
```

Body should explain **why**, not what (the diff shows the what). PRs that change more than one concern should be split.

## Git workflow

- Branch from `main` or current macro branch only.
- Squash-merge on PR close. Linear history on `main`.
- Tag only after a macro task is fully merged and validated.
- Never force-push to `main`. Force-push on feature branches only if no other contributor is reviewing.
