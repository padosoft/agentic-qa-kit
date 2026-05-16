# Lessons

> Persistent journal of non-obvious things learned while building `agentic-qa-kit`. Read this before starting any sub-task; update it after every Copilot review iteration that surfaces something worth remembering. Entries dated `YYYY-MM-DD`. Newest first.

## How to use this file

- **Read** before starting a sub-task: skim the last 30 entries.
- **Read** when a sub-agent is being spawned: pass relevant entries in the prompt.
- **Write** when:
  - You discovered a non-obvious setup fact, API quirk, library gotcha, or test workaround.
  - Copilot review surfaced a pattern or correctness issue worth remembering.
  - A bug fix had a non-obvious root cause.
  - A decision was made that future agents will need context for.
- **Do not write** code conventions that belong in `docs/RULES.md` instead, or planning items that belong in `docs/PROGRESS.md`.

## Format

```markdown
## YYYY-MM-DD

- Topic / context — what was learned + why it matters. Reference files/commits when useful.
```

## 2026-05-17

- **PR #1 Copilot/Codex review surfaced 15 issues, all addressed in `416ba19..HEAD`. Patterns worth remembering:**
  - **Never commit maintainer-local paths** (`%USERPROFILE%`, `C:\Users\<name>`, sibling-repo references like `../foo`) into docs that AI agents and contributors must read. AGENTS.md/CLAUDE.md/RULES.md should reference **in-repo paths only**. Any out-of-repo references belong in a maintainer-private notes file.
  - **Bash `|| true` on CI gates is a silent-failure trap.** Codex flagged the Node test job and Copilot flagged the link-check + Copilot-review steps. Use `continue-on-error: true` for advisory steps (failure is visible in the job summary even if it does not break the workflow) and propagate exit codes through `set -e` + explicit `worst=$max(...)` accumulators for hard gates. Logged separately for emphasis.
  - **Placeholder npm scripts that just `echo` will silently pass once real packages exist** unless they actively run the per-workspace script. The fix is a portable Node script (`scripts/run-workspace-script.mjs`) that enumerates `package.json` files matching the workspace glob and runs the named script in each one that defines it. No `--filter` needed (avoids the "No packages matched the filter" error when workspaces are empty).
  - **`"prepare": "true"` is not cross-platform.** Windows has no `true` builtin. Use `node -e ""` or omit the script.
  - **Test scripts pair must be consistent:** if `test` is a no-op placeholder, `test:watch` must be too (or both must run real tests). Inconsistent behavior breaks junior expectations.
  - **`tsconfig.json` excluding `**/*.test.ts` from typecheck silently lets type regressions sneak into tests.** The strict-TypeScript rule applies to test code too. Don't exclude tests from the base config; if tests need different settings, use a separate `tsconfig.test.json` that re-includes them.
  - **`.gitattributes`: duplicate `text eol=lf` lines are silently accepted by git but flagged as redundant by reviewers.** Always dedupe.
  - **Italian docs in `docs/` confuse English-speaking contributors and AI agents.** Move maintainer-internal docs to `docs/internal/` and add an English audience note at the top.
  - **README/docs with markdown links to files that don't exist yet render as 404s on GitHub.** Either drop the link syntax (plain text) or create a stub file. Done both: stubs created for `docs/architecture/reference.md`, `docs/security/threat-model.md`, `docs/methodology/agentic-qa.md`.
  - **`SECURITY.md` should not list "future versions" as supported.** Only released lines belong in the Supported Versions table.
  - **Tailwind v4 dark mode syntax: `@theme dark { ... }` does not exist.** Use `@custom-variant dark (&:where(.dark, .dark *))` + a `.dark { --color-...: ... }` override block. Fix applied to `docs/design/admin-panel-template.md`.
  - **Biome `noConsole` rule fires on Node CLI scripts where console output IS the UX.** Use Biome `overrides` to disable `suspicious/noConsole` for `scripts/**` rather than peppering the file with `// biome-ignore` comments.
- **GitHub Copilot Code Review is an integrated reviewer in this repo.** Detected because the bot appears as `Copilot` (id 175728472, app `copilot-pull-request-reviewer`). The chatgpt-codex-connector is also auto-attached and reviews independently. Both surface useful inline comments.
- **Bun lockfile version compatibility:** Bun 1.3.x produces `bun.lock` with `lockfileVersion: 1`. Bun 1.1.x **cannot parse it** and errors `Unknown lockfile version` + (with `--frozen-lockfile`) `lockfile had changes, but lockfile is frozen` → CI fails before any other step. Fix: pin `.bun-version` to whatever Bun version is used to produce the lockfile (use `oven-sh/setup-bun@v2` with `bun-version-file: .bun-version`) **and** the `packageManager` field in `package.json` to the same. Lesson learned the first time Task 0 ran in CI.
- The reference repo `product_image_discovery_admin` documents a Copilot Code Review request fallback when `gh pr edit --add-reviewer @copilot` fails with `read:project` scope errors. Use the GraphQL `requestReviewsByLogin` mutation with `botLogins[]='copilot-pull-request-reviewer[bot]'` and `union=true`. The REST endpoint `reviewers[]=copilot` is **not equivalent** — it can return 200 without creating a visible Copilot Code Review request. Captured in `AGENTS.md § Branch and PR loop`.
- **GitHub `gh` CLI for Copilot review works** when the token has `read:project` scope (we have it: gho_*** with `repo, read:org, read:project, gist, admin:public_key`). `gh pr edit <num> --add-reviewer copilot-pull-request-reviewer` succeeds and `gh api repos/.../pulls/<num>/requested_reviewers` returns Copilot in the users array. The GraphQL fallback is needed only when the token lacks scopes.
- The reference repo also reports that `requestReviewsByLogin` can succeed (returning `clientMutationId: null`) while the resulting `reviewRequests` collection stays empty, treated as an API-side regression. Workaround: request Copilot review manually from the PR sidebar Reviewers menu. **Do not silently skip review** — record the blocker in `docs/PROGRESS.md` instead.
- Bun + TypeScript ESM + strict + `noUncheckedIndexedAccess` is the chosen baseline. Some libraries still ship CJS-only types; pin a `tsconfig.json` per-package when a CJS dep forces module interop relaxation, never relax it globally.
- For Bun workspaces, the root `package.json` uses `"workspaces": ["packages/*", "packs/*"]`. `bun install` from root installs all workspaces. `bun --filter <name> <script>` runs a script in a single workspace. `bunx -p <pkg> <bin>` runs a binary from a specific package version.
