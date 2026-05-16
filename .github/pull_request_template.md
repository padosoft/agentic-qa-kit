<!--
Thank you for contributing to agentic-qa-kit!
Please read AGENTS.md § Branch and PR loop and docs/RULES.md before submitting.
This template enforces the Definition of Done.
-->

## Goal

<!-- What does this PR accomplish? One sentence. -->

## Scope

- **Macro task:** <!-- e.g. Task 0 — Bootstrap governance -->
- **Sub-task:** <!-- e.g. 0.4 CI workflow -->
- **Branch:** <!-- task/<macro>/<sub> -->
- **Target:** <!-- macro branch name, or `main` for macro PR -->

## What changed

<!-- Bullet list of what changed and why (NOT what the diff shows). -->

-
-

## Definition of Done checklist

Per `AGENTS.md § Definition of Done`:

- [ ] Implementation complete per the sub-task spec
- [ ] Local gates green: `bun install`, `bun run typecheck`, `bun run lint`, `bun test`, `bun run build`
- [ ] If UI/UX touched: `bunx playwright test` green for the new interactions
- [ ] Unit test coverage ≥ 80% on new non-trivial code
- [ ] Integration tests cover every new cross-package boundary
- [ ] Package README updated (badges, TOC, features, junior-friendly setup)
- [ ] `docs/PROGRESS.md` updated with current state and next step
- [ ] `docs/LESSON.md` updated with any non-obvious discovery
- [ ] ADR written if an architectural decision was made (`docs/adr/`)
- [ ] No secrets in diff, no `.env` committed
- [ ] Conventional Commit message style respected

## Copilot review

- [ ] Copilot Code Review requested (`gh pr edit <num> --add-reviewer copilot-pull-request-reviewer` or GraphQL fallback)
- [ ] Will wait for CI green AND Copilot comments before merge
- [ ] Will resolve every Copilot comment or reject explicitly with motivation

## Related

<!-- Issues, ADRs, prior PRs, plan section references. -->

-
