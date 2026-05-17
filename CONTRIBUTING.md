# Contributing to agentic-qa-kit

Thanks for your interest. This guide is mandatory reading before submitting a PR.

## Read first

1. `AGENTS.md` — operating rules, branch strategy, PR loop, Definition of Done
2. `docs/RULES.md` — UI/UX, security, testing, doc rules
3. `docs/PROGRESS.md` — current macro task and state
4. `docs/LESSON.md` — accumulated lessons (so you don't repeat past mistakes)

If you skip these, your PR will likely be sent back without review.

## Getting set up

```bash
git clone https://github.com/padosoft/agentic-qa-kit.git
cd agentic-qa-kit
bun install
bun run typecheck
bun run lint
bun test
```

Need Bun? See `docs/getting-started.md § Install Bun`.

## Branching & PRs

We follow the macro/sub-task model documented in `AGENTS.md § Branch and PR loop`. Summary:

- New feature: open `task/<descriptive-slug>` from `main`.
- Multi-PR features: sub-PRs into the macro branch, then one macro PR to `main`.
- Every PR requests Copilot Code Review automatically (see `.github/workflows/copilot-review.yml`).
- Conventional Commits + gitmoji optional.

## Definition of Done

Your PR is merge-ready only when:

- ✅ Local gates green (`bun run typecheck`, `bun run lint`, `bun test`, `bun run build`, Playwright if UI)
- ✅ Coverage ≥ 80% on new non-trivial code
- ✅ Package README updated
- ✅ `docs/PROGRESS.md` and `docs/LESSON.md` updated where relevant
- ✅ ADR written for any architectural decision
- ✅ Copilot review processed (no blockers)
- ✅ CI green

## Code style

- TypeScript strict, ESM only.
- Biome enforced. Format on save.
- No `any` without justification.
- No silent catch. No commented-out code in committed diffs.
- Tests use `describe` / `it` (or `test`) + `expect`.

## Adding a new pack

```bash
bunx aqa pack create <slug>
bunx aqa pack validate packs/<slug>
bunx aqa pack test packs/<slug>
```

See `docs/authoring-packs.md` (v0.3) once available.

## Security issues

**Do not file public issues for real vulnerabilities.** See `SECURITY.md` for the private disclosure channel.

## Code of Conduct

By participating you agree to the `CODE_OF_CONDUCT.md`.

## License

By contributing you agree your contributions are licensed under Apache-2.0 (the project license).
