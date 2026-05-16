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

- **Bun lockfile version compatibility:** Bun 1.3.x produces `bun.lock` with `lockfileVersion: 1`. Bun 1.1.x **cannot parse it** and errors `Unknown lockfile version` + (with `--frozen-lockfile`) `lockfile had changes, but lockfile is frozen` → CI fails before any other step. Fix: pin `.bun-version` to whatever Bun version is used to produce the lockfile (use `oven-sh/setup-bun@v2` with `bun-version-file: .bun-version`) **and** the `packageManager` field in `package.json` to the same. Lesson learned the first time Task 0 ran in CI.
- The reference repo `product_image_discovery_admin` documents a Copilot Code Review request fallback when `gh pr edit --add-reviewer @copilot` fails with `read:project` scope errors. Use the GraphQL `requestReviewsByLogin` mutation with `botLogins[]='copilot-pull-request-reviewer[bot]'` and `union=true`. The REST endpoint `reviewers[]=copilot` is **not equivalent** — it can return 200 without creating a visible Copilot Code Review request. Captured in `AGENTS.md § Branch and PR loop`.
- **GitHub `gh` CLI for Copilot review works** when the token has `read:project` scope (we have it: gho_*** with `repo, read:org, read:project, gist, admin:public_key`). `gh pr edit <num> --add-reviewer copilot-pull-request-reviewer` succeeds and `gh api repos/.../pulls/<num>/requested_reviewers` returns Copilot in the users array. The GraphQL fallback is needed only when the token lacks scopes.
- The reference repo also reports that `requestReviewsByLogin` can succeed (returning `clientMutationId: null`) while the resulting `reviewRequests` collection stays empty, treated as an API-side regression. Workaround: request Copilot review manually from the PR sidebar Reviewers menu. **Do not silently skip review** — record the blocker in `docs/PROGRESS.md` instead.
- Bun + TypeScript ESM + strict + `noUncheckedIndexedAccess` is the chosen baseline. Some libraries still ship CJS-only types; pin a `tsconfig.json` per-package when a CJS dep forces module interop relaxation, never relax it globally.
- For Bun workspaces, the root `package.json` uses `"workspaces": ["packages/*", "packs/*"]`. `bun install` from root installs all workspaces. `bun --filter <name> <script>` runs a script in a single workspace. `bunx -p <pkg> <bin>` runs a binary from a specific package version.
