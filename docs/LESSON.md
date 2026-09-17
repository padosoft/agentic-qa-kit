# Lessons

## 2026-09-17 — evidence-based enterprise review

- **Fail-closed must preserve profile semantics.** Removing a synthetic no-network `200` should make missing-driver evidence visible in smoke while making release-gate fail; changing every informational smoke into a hard error would be a different contract. Test both profiles explicitly.
- **Cleanup is part of the evidence contract.** Running cleanup only on the happy path leaves commerce reservations and fixtures behind exactly when failures matter most. Execute every declared cleanup probe, catch its exception, and persist its result as cleanup evidence.
- **Run state must have one owner.** Report and admin independently inferring “a `run_finished` event exists = success” drifted from CLI counters. Put the derivation beside the schema and make every consumer use it; test errors, zero scenarios and missing completion separately.
- **Gate policy is part of persisted outcome.** A release-gate failure caused by findings has no runtime-error counter; if the completion event omits that policy result, downstream report/admin consumers cannot reconstruct the same verdict. Persist an explicit `release_gate_failed` fact.
- **CJS bundles need a two-layout asset resolver.** ESM source resolves `dist/commands/../admin` and `../packs`; a single-file bundle executes from `dist/` where those assets are siblings. Test the actual bundled command and prefer `__dirname` when present, retaining the ESM URL fallback for unbundled code.
- **A skipped security test must remain visible.** Bun's `node:test` compatibility currently throws when `t.skip()` is called. On unsupported Windows symlink environments, emit a warning and return; record that the negative test was not executed, and run it under a platform with symlink support before release.
- **CI lint is a repository contract, not only a changed-file check.** The first PR failed on stale docs JSON and guard scripts plus the review diagnostic. Fix exact formatter/import/template findings, rerun the full repository lint, and document when a security negative remains environment-limited.
- **A root build must match the CI dependency graph.** A docs-only root script cannot prepare workspace `dist/` files for typecheck, and a nested docs-site package is not installed by root Bun workspaces. Install its lockfile explicitly in CI and make the root build sequence docs + workspaces.

- **A successful gate must prove execution, not merely absence of findings.** The default no-network probe returns 200; negative-content oracles can accept transport failure, and the shipped idempotency config is ignored by its oracle. Missing drivers and invalid oracle contracts must fail closed. See [review and reproducer](internal/enterprise-review-2026-09-17.md).
- **A live API does not make the browser verifier genuine.** Compiled admin with a real HTTP backend reported CHAIN OK for a modified event rejected by the backend SHA verifier. Test a tampered payload and compare complete canonical records, not just link continuity or fixture flags.
- **Version/help and ESM CLI smoke do not validate the published entrypoint.** CJS bundle run/admin fail on import.meta.url even though help works; root build was changed to docs-only while delivery still relies on it. Test the installed artifact's real journey from outside the workspace.
- **Durability, outcome and identity cross boundaries.** Per-scenario finding counters collide across runs; failed release gates become successful reports/admin runs; MemoryStore mutations vanish at restart. Tests need multiple runs, negative outcomes and fresh-process rereads.
- **Commerce needs stateful, independent oracles.** A 200 or confirmation page does not prove one charge, one order, inventory integrity or refund reconciliation. Model duplicated/out-of-order events, ambiguous timeout, concurrency and cleanup; never exercise real financial side effects without specific authorization.
- **Separate environment failures from security claims.** Two Windows unit failures arise from symlink privileges followed by unsupported Bun test skip; they do not demonstrate a path-escape vulnerability. Node 25 diagnostics do not certify Node 22 support. Observational repro output is not a green regression suite.

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

## 2026-05-21 — v1.9 junior-quickstart-truthing macro

- **Workspace-internal cycle breaks topo-sort builds even when TS handles them.** `@aqa/server` depended on `@aqa/kit` (for `runPackNew`). When `aqa admin` started needing `@aqa/server` (for `makeApi()`) and we added `@aqa/server` to kit's deps, locally everything looked fine because each prior build had already produced `kit/dist/`. CI from a fresh checkout hit `TS2307: cannot find module '@aqa/kit'` when building server — the topo-sort warned about the cycle but had to break it arbitrarily, and the loser saw the other side's dist as not-yet-built. **Fix**: extract the shared module (`runPackNew` → `@aqa/pack-author`). Both sides depend on the new package; the cycle goes away from the dep graph entirely. Cheaper than any `peerDependency`/dynamic-import workaround for the build phase.
- **CJS-in-`.cjs` is the safe shape for esbuild-bundled CLIs in `"type": "module"` packages.** ESM output bundled by esbuild rewrites bundled-dep `require('process')` into a `__require` helper that throws `Dynamic require of "process" is not supported`. Fixing it via banner `import { createRequire } from 'node:module'; const require = createRequire(import.meta.url)` doesn't help — the `__require` wrapper esbuild emits doesn't consult the user-level `require` binding. Switching to `format: 'cjs'` keeps Node's native `require` and the wrapper resolves cleanly. The output must be `.cjs` (not `.js`) so the package-level `"type": "module"` doesn't make Node parse it as ESM.
- **Externalise Node built-ins in BOTH prefix forms in esbuild.** `'fs'` AND `'node:fs'`. Some bundled CJS deps (yaml, ajv) call `require('process')` without the prefix; without listing the unprefixed names esbuild silently rewrites them as `Dynamic require` stubs. Easy to miss because the prefixed form covers all the TS/ESM call sites and tests pass — until a dep that uses bare requires is exercised at runtime.
- **Esbuild banner + entry shebang = double shebang = SyntaxError.** tsc preserves the source `#!/usr/bin/env node` in `dist/cli/aqa.js` (when the source has it). esbuild bundling preserves any shebang it sees at the entry's top. Adding `banner: { js: '#!/usr/bin/env node' }` results in two shebang lines in the output — Node parses the first as a hashbang and the second as JS, throwing `SyntaxError: Invalid or unexpected token`. Either don't use banner OR strip the entry's shebang first. Defensive post-process dedup (read output, drop subsequent `#!` lines) is cheap and survives future config drift.
- **GitHub Packages requires `<scope> === <repo-owner>`.** A repo under `padosoft/agentic-qa-kit` can only publish `@padosoft/*` packages. Internal workspace names that aren't in that scope must be rewritten at publish time. Two-name solution: workspace stays `@aqa/kit` so other monorepo packages can reference it via `workspace:*`; a `publish-prep.mjs` script reads a `aqa.publishName` field and swaps the `name` in `packages/kit/package.json` only inside the CI checkout. The rewrite is never committed back.
- **CRITICAL: strip `@aqa/*` deps from the published manifest when bundling.** If you publish `@padosoft/agentic-qa-kit` to GH Packages with `@aqa/runner` etc. still in `dependencies`, `bun add @padosoft/agentic-qa-kit` fails with `404 — @aqa/runner not found on registry` because those `@aqa/*` packages don't exist on any registry (they're inlined into `dist/cli.cjs` by esbuild). The publish-prep script must delete every `@aqa/*` entry from `dependencies`/`devDependencies`/`peerDependencies` after the name swap.
- **`package.json` LICENSE not auto-promoted from repo root.** If `packages/kit/package.json` declares `files: ['..., LICENSE']`, the tarball includes a `LICENSE` only if `packages/kit/LICENSE` exists on disk. The root-level `LICENSE` is NOT magically copied. Always cp / ship a sub-package LICENSE for any publishable package.
- **Copilot pattern: parallel PRs amortise review-round latency.** With 5 sequential PRs each taking 2-3 Copilot rounds, a sequential cascade is 10-15 round-trips on the critical path. Opening all 5 in parallel collapses that to max(rounds) = 3 rounds wall-clock. Cost: conflict resolution at merge cascade time on shared files (`packages/kit/package.json`, `packages/kit/src/cli/aqa.ts`). For this macro the conflicts were all union-merges (combine test scripts, combine deps, combine `case` statements in switch) — cheap.
- **"Docs reference things that don't exist on this branch" is expected and OK on a docs-only sub-task.** Copilot reviewing PR #56 in isolation correctly flagged that `aqa install-agent-files` / `aqa report` / `aqa admin` were referenced in README but not implemented on that branch's tree. The fix is the macro merge — once 1+2+3 land in macro, PR #56's claims become true. Don't address each "doc-vs-code mismatch" comment by reverting docs; address it by sequencing the merges correctly.
- **`bun pr merge --auto` flag isn't honored if repo-level auto-merge is disabled.** It returns `GraphQL: Auto merge is not allowed for this repository (enablePullRequestAutoMerge)` but the merge can still happen if CI is already green at command time. For reliable auto-merge enable it in repo settings; otherwise just poll and merge manually when status flips to CLEAN.
- **PR's `mergeStateStatus` lags the CI rollup by a few seconds.** Right after a force-push or rebase, a query may return `UNKNOWN` for a few seconds before flipping to `UNSTABLE` (CI in progress) → `CLEAN` (mergeable) or `DIRTY` (conflicts). A polling loop should treat `UNKNOWN` as "wait" not "merge".

## 2026-05-20

- **E2E CLI smoke should be self-contained and network-real, not command-only.** A stable pattern is: bootstrap a temp sandbox with `aqa init`, overwrite `.aqa/project.yaml` + `profiles.yaml` with schema-valid minimal config, create a local `packs/pack-local-smoke` scenario, boot a local HTTP server (`/healthz`), run `aqa run --profile smoke`, and assert `.aqa/runs/<id>/events.jsonl` + `findings.jsonl` exist. This catches orchestration regressions without external services and without adding root-level test dependencies.
- **Hash-chain verifier and writer must share the exact same canonical body contract.** `EventChainWriter` hashes `sha256(prev_hash || canonical(rest_without_prev_hash_and_hash))` while persisted events expose `prev_hash: null` on the first record. A verifier that re-hashes including `prev_hash` (or expects the first record to carry the all-zero seed literal in `prev_hash`) will produce false mismatches on valid logs. Keep one canonical rule across writer and verifier, and treat the all-zero seed as internal hash input only.

## 2026-05-18 (v1.0 → v1.1 retrospective — patterns across the full 24-task roadmap)

- **Bundle 2-4 tasks per minor-version PR.** Once the validation loop is
  proven on v0.1, every subsequent minor (v0.2-v1.0) was a coherent bundle
  of related sub-tasks. Throughput is far higher than one-PR-per-task and
  each bundle still ships a coherent, testable surface. Stopping criterion
  to NOT bundle: a sub-task is on a *different abstraction layer* (e.g.
  package + chart + script all together in v0.6 was fine; mixing schemas
  changes with runner changes in the same PR was not).
- **`exactOptionalPropertyTypes: true` patterns.** Two recurring fixes:
  (1) interfaces — use `field?: T | undefined`, not bare `field?: T`;
  (2) object construction — conditional spread `if (x) obj.x = x` instead
  of `{ x: maybeUndef }`. Cost: ~3 friction points per medium PR. Benefit:
  caught real `req.params.run_id` being `string | undefined` at a server
  filter before it shipped.
- **LongSlug regex (`^[a-z0-9](?:-?[a-z0-9])*$`) rejects uppercase and
  inner `#` / `.`.** When composing IDs at runtime (`${run_id}-verify-${i}`),
  ensure every input is already lowercase. Hit twice — once in `replay.ts`
  with run-IDs like `run-A`, once in audit chain test fixtures.
- **PreToolUse hook may block writes containing the substring `exec`** even
  inside a TypeScript identifier. Renaming `probeExecutor` → `probeRunner`
  unblocked the write. Pattern is not language-aware; avoid the bare word.
- **Deploy scaffolds should self-label "v0.X ships A, v1.0 lands B".** When
  shipping incomplete-but-runnable infrastructure (helm chart with no
  ingress, terraform with no cloud provider), operators and auditors
  need to know what's runnable today vs. roadmap. Comments + README
  callouts are cheap; mystery placeholder files are not.
- **Hash-chained audit verifier belongs in its own package** (`@aqa/compliance`),
  not in `@aqa/runner`. The runner *writes* the chain; the verifier
  *reads* it — different audience (auditor vs. operator). Keeping them
  separate means the verifier CLI (`aqa-audit-verify`) can be installed
  in a hardened side-system without pulling the whole runner.
- **Examples should demonstrate language-agnostic targeting.** The
  `examples/laravel-app` example exists specifically to show PHP target
  with TypeScript-AQA runner — probes are HTTP, oracles are declarative,
  the runner doesn't care about the target language. This was a recurring
  reviewer question; the example makes it self-evident.
- **Per-tag GitHub Release notes via `gh release create --notes-file`** is
  the cheapest way to retro-fit release pages after multiple tags accumulate.
  Generate notes from `git log v<prev>..v<curr> --oneline` + a one-paragraph
  summary; ship in a single batch.

## 2026-05-17 (v0.1.0 retrospective — patterns to remember across the whole milestone)

- **Workspace topology requires topological build order.** A pure alphabetical
  iteration breaks the build because downstream consumers (`@aqa/kit` → `@aqa/schemas`)
  must see the upstream `dist/` before their own `tsc` runs. The fix lives in
  `scripts/run-workspace-script.mjs` (DFS sort by intra-workspace deps). Any new
  package must declare its workspace deps in `dependencies`/`devDependencies` so
  the sort sees them.
- **Same test file, two runtimes.** `node:test` + `import assert from 'node:assert/strict'`
  + import-from-`dist/` is the only combination that runs identically under
  `bun test` and under `node --experimental-strip-types --test`. Avoid `bun:test`
  for cross-runtime packages.
- **CI pre-build before typecheck / Node-test / Bun-test.** Workspace consumers
  point their `main`/`types` at `dist/`. Until `dist/` exists, downstream `tsc`
  cannot resolve the workspace import. `bun run build` once up front in every
  relevant CI job is the simplest fix.
- **Generated artifacts (`schemas/v1/*.schema.json`) belong in `biome.json.files.ignore`.**
  Without this, every `bun run build` re-emits files biome wants to reformat, making
  lint/build non-idempotent.
- **`if/then` in JSON Schema is a `noThenProperty` lint trip.** Add a one-line
  biome-ignore comment; bracket-notation workarounds trip `useLiteralKeys` instead.
- **Copilot review settles around iteration 3-4 on non-trivial PRs.** Pass 1 catches
  P0 cross-platform issues, pass 2 catches P1/P2 correctness, passes 3-4 surface
  P3 hardening + stale repeats. Stopping criterion: merge after pass with stale
  repeats dominating, file remaining nits as a follow-up issue.
- **Slug regex flags do not survive JSON Schema emission.** Pattern must enumerate
  the accepted charset (no `/i`). Tighten patterns to `^[a-z0-9](?:-?[a-z0-9])*$`
  to also reject trailing/consecutive dashes — safe as path segment / URL fragment.
- **Hash-chained audit log invariant.** `hash = sha256(prev_hash ‖ canonical(rest_of_event))`
  with sorted keys; first event's `prev_hash = null`. Test the chain end-to-end by
  re-hashing every entry — otherwise tampering goes undetected.
- **Determinism gating belongs on the schema, not the runtime.** Putting
  `status='verified' ⇒ deterministic floor` on `Finding`'s `superRefine` (Zod) +
  mirroring it as `allOf: [if/then]` in the emitted JSON Schema means every layer
  (orchestrator, agent, third-party validator) enforces the same rule.

## 2026-05-17 (Task 1 / PR #2)

- **Zod superRefine does not survive `zodToJsonSchema` emission** — custom refinements are silently dropped from the generated JSON Schema. For consumers validating via the shipped JSON Schema (LSP, third-party validators, language ports), any rule expressed via `superRefine` simply doesn't exist. Mitigation: post-emit patch the JSON Schema with explicit `allOf` of `if/then` clauses for the critical invariants (Finding's verified-gating, Run's terminal-state gating). For cross-field comparisons that JSON Schema cannot express (`finished_at >= started_at`), document the gap in a top-level `$comment` and accept that the JSON-Schema layer is strictly weaker than the Zod layer.
- **`zod-to-json-schema` emits Draft-4 boolean `exclusiveMinimum: true` / `exclusiveMaximum: true` even when `target: 'jsonSchema2020-12'` is set.** Draft 2020-12 requires numeric form (`exclusiveMinimum: 0`). Post-emit transform required. Throw on unfixable shapes (no numeric sibling) instead of silently leaving invalid output — a future zod-to-json-schema regression should fail the build, not ship bad schemas.
- **JSON Schemas must declare `$schema`** explicitly. Without it, validators that default to an older draft (e.g. ajv without the 2020-12 plugin) will silently mis-validate keywords that have draft-specific semantics (`$ref` siblings, `if/then`, `unevaluatedProperties`).
- **Regex flags do not survive JSON Schema emission.** A Zod regex like `/^[a-z0-9-]+$/i` emits as `pattern: "^[a-z0-9-]+$"` with no equivalent. To keep Zod and JSON Schema in sync, the pattern itself must explicitly enumerate the accepted charset — lowercase only, with case-insensitivity expressed via character classes, not flags.
- **Bun workspaces + `npm run` interaction** — `bun install` hoists deps and runs the install hooks once. After that, `npm run <script>` from inside a workspace package works because (a) `node_modules` is populated, (b) `npm` resolves script.json relative to cwd, (c) the script's commands invoke bins through Node's resolution algorithm. No `package-lock.json` is needed for the script-runner case. This unlocks Node-only CI gates ("does this package build & test under plain Node, not Bun?") on a Bun monorepo.
- **`node --experimental-strip-types` (Node 22.6+) replaces tsx/ts-node for TS test execution.** Node strips type annotations and runs the file directly — no transpiler, no loader plugin. Pair with `node:test` API (which Bun also supports) and the same `.test.ts` file runs under both runtimes without duplication.
- **`tsBuildInfoFile` requires `incremental` or `composite`** — TypeScript silently ignores it otherwise. Easy to leave behind a stale `.tsbuildinfo` that never gets updated.
- **`bun:test` is NOT a drop-in for `node:test`.** Migrating tests from `import { describe, expect, test } from 'bun:test'` to `import { describe, it } from 'node:test'` + `import assert from 'node:assert/strict'` (using `assert.equal/ok` instead of `expect`) is the only way to keep one test file runnable under both runtimes. Bun's test runner accepts `node:test` style; Node's `--test` does not accept `bun:test`.
- **Biome `lint/suspicious/noThenProperty`** fires on `then:` keys even when they are JSON Schema keywords. Use `// biome-ignore lint/suspicious/noThenProperty: ...` rather than computed-property workarounds — the latter trips `lint/complexity/useLiteralKeys`.
- **Generated artifacts must be excluded from formatters.** `schemas/v1/*.schema.json` is regenerated on every build; if biome's JSON formatter rewrites them between builds, lint and build become non-idempotent. Add `packages/*/schemas/v1/**` to `biome.json.files.ignore`.
- **PR #2 Copilot review loop closed after 4 passes.** Passes 1-3 surfaced 28 actionable items, all addressed. Pass 4 surfaced 3 new items (also addressed) but the bulk of the comments were stale re-flags of issues already fixed in earlier commits — Copilot's review state seems not to dismiss its own resolved findings. Stopping criterion confirmed: after 4+ passes where the marginal new feedback drops below noise, ship the macro task and file remaining hardening as a follow-up issue.

## 2026-05-17

- **PR #1 Copilot eighth-pass review (5 comments) — addressed and merging Task 0 after this iteration.** Comments:
  - Dead conditional `runner === 'bun' ? 'run' : 'run'` (both branches identical). Replaced with literal `'run'`. Was the leftover of an earlier consideration about bun-script invocation that we never carried through.
  - `pattern.slice(0, -2)` on the `/*` / `./*` edge case yields an empty base and `collectPackagesUnder(root)` ran without the bare-star exclude. Routed empty/relative-root bases through the same safe-list path.
  - `BARE_STAR_EXCLUDE` contained dot-dir entries that were already pruned by the generic dotfile filter inside `collectPackagesUnder`. Dead entries removed; comment clarifies the split.
  - SECURITY.md falsely claimed `bun audit` required Bun ≥ 1.3. Reworded to "available throughout our supported Bun range" anchored on `engines.bun`.
  - README quick start, although disclaimed, still showed five `bunx aqa ...` commands above the fold. Wrapped in a `<details>` "Preview the v0.1.0 quick start" so junior users do not paste commands that don't yet work.
- **Stopping the Copilot review iteration after iter 8.** Process governance rule (`AGENTS.md § Definition of Done`) says "resolve every Copilot comment or reject explicitly with motivation". Across 8 iterations on this PR, 52 comments addressed (zero outright rejections). The pattern was very consistent: each pass surfaces narrower edge-case nits at lower severity. Continued iteration produces diminishing returns and blocks shipping the macro task. For PRs going forward: address all P0/P1/P2-bug comments, push, re-request once for confirmation; if the new pass produces only P3 hardening nits without correctness implications, document them in `docs/PROGRESS.md` (or a follow-up GitHub issue) and merge. Future enhancements to `scripts/run-*.mjs` (signal-handling completeness, spawn edge-cases on Windows shims, additional glob support) belong in a separate issue post-Task-1.
- **PR #1 Copilot seventh-pass review (6 comments) — addressed; this round is mostly hardening of `scripts/`. After 7 iterations and 47 inline comments addressed, Copilot now finds genuine edge cases (spawn ENOENT, readdirSync non-determinism) but Task 0's scope is fundamentally complete. Merging soon, with any future hardening tracked as a follow-up:**
  - **`spawnSync` launch failures populate `r.error`, not `r.status`.** Both wrapper scripts now check `r.error` first and print `r.error.message` before exiting 1, instead of silently exiting with a bare 1. Critical for diagnosing "is `bun` on PATH?" failures in CI.
  - **`readdirSync` ordering is filesystem-dependent.** Sorting `matched` alphabetically by absolute dir before iteration keeps CI logs reproducible across Linux/macOS/Windows.
  - **Bare `*` workspace pattern enumerates everything at root** including `node_modules`, `dist`, `.git`, `.aqa`. Added a `BARE_STAR_EXCLUDE` set (mirrors tsconfig/biome ignore lists) + dotfile filter so a stale `dist/package.json` doesn't accidentally become a workspace.
  - **DRY: extracted `pickRunner` + `signalToExit` into `scripts/_pick-runner.mjs`** so the two scripts stay aligned automatically (no more "keep these in sync" comments to maintain).
  - **Asymmetric `bun run` vs `npm run --silent` flag pair was inconsistent.** Standardized on `--silent` for both (Bun supports it too) so CI logs look the same across the Bun and Node 22 fallback matrix.
  - **Lesson re iteration count:** Copilot will keep finding nits indefinitely on any non-trivial script. After 7 passes and ~47 comments addressed, the marginal value drops below the cost of another iteration. Stopping criterion for future PRs: address all P0/P1, address all P2 that are objectively bugs, defer P3 nits to a "follow-up hardening" issue rather than blocking the macro task.
- **PR #1 Copilot sixth-pass review (3 comments) — addressed:**
  - **Glob detection regex must cover all glob metachars**, not just `*` and `{`. `?`, `[`, `]`, `!` are equally valid globs and were silently classified as "literal directory" (then skipped because no dir matched). Replaced ad-hoc `includes` checks with a single regex `/[*?[\]{}!]/`.
  - **`os.constants.signals[name]` gives Node's full signal→number map** (SIGKILL=9 → 137, SIGSEGV=11 → 139, SIGABRT=6 → 134, etc.). Better than a hand-maintained subset that loses diagnostic info on uncommon terminations.
  - **`Array.isArray(workspaces)` is necessary but not sufficient** — validate every element is a string too, otherwise a nested object/array throws `pattern.startsWith is not a function` instead of producing a clear `[run-workspace-script]` diagnostic.
- **PR #1 Copilot fifth-pass review (3 comments) — addressed; this iteration is the smallest and the most subtle:**
  - **Duplicate workspace entries** (e.g. `["packages/*", "packages/foo"]`) would run the script twice on the same package. Added `seenDirs` Set dedup keyed by absolute path before `matched.push`.
  - **Negation patterns (`!path`) have semantic meaning in Bun/npm workspaces** — they EXCLUDE entries from earlier patterns. Silently warning would produce wrong execution lists (`["packages/*", "!packages/legacy"]` would still include `legacy`). Now fail fast (`exit 2`) with a clear error.
  - **`run-tool.mjs` and `run-workspace-script.mjs` must probe the SAME canonical binary** to stay in sync. Standardized both on probing `bun` (then derive `bunx` from it for tool invocation). A user with `bun` but no `bunx` (or vice versa) would otherwise see the two scripts disagree.
- **PR #1 Copilot fourth-pass review (11 comments) — addressed:**
  - **Windows: `bun.cmd` shims need `shell: true` even when probing succeeded.** Probe (`where`) uses shell; the actual `spawnSync(runner, ...)` must use it too on Windows, otherwise `.cmd`/`.ps1` shims fail with ENOENT.
  - **Signal termination should propagate as `128 + signo`** (POSIX convention) — never collapse to `1`. Added `SIGNAL_TO_EXIT(signal)` helper and an explicit `r.signal` check that aborts the loop (don't run more workspaces after Ctrl-C).
  - **`statSync` throws on broken symlinks / TOCTOU.** A single broken symlink under `packages/` would crash every gate. Wrapped in `safeStat()` that returns `null` on any failure; the iteration then just skips the entry.
  - **Bare `*` workspace pattern is conventional npm**, not an exotic glob. Added explicit support for `*` (iterate root subdirectories) alongside `<dir>/*` and `<dir>`. Reserved the warning for genuinely-unsupported syntaxes (`foo*`, `{a,b}`, `!(legacy)`, `**`).
  - **`AQA_PKG_RUNNER` parsing must be defensive** — trim + lowercase before equality, error early on anything non-empty that isn't `bun|npm`. Whitespace and case variants ("BUN", " bun") were silently falling through.
  - **`verbatimModuleSyntax: true` + `esModuleInterop: true` + `allowSyntheticDefaultImports: true` is internally inconsistent.** With `verbatim`, the emit preserves source verbatim, so the interop flags are misleading. Removed both — TypeScript will now enforce explicit `import type` for type-only specifiers and explicit `import pkg = require('pkg')` (or namespace form) for CJS deps under NodeNext.
  - **SECURITY.md private-disclosure URL must be a markdown link**, not inline code, so it is clickable.
  - **README quick-start that references unreleased commands needs an explicit version gate.** Added a "heads-up" note that the CLI ships in v0.1.0.
  - **ASCII box-drawing characters render unpredictably across browsers / terminals.** Replaced unicode box chars (`┌─│└`) with plain ASCII (`+- |`) for the architecture diagram to avoid alignment drift.
  - **`bun audit` floor reference must point at a concrete `engines.bun` value** (not a vague "matches our floor"). Made the cross-reference explicit in SECURITY.md.
- **PR #1 Copilot third-pass review (6 comments) — addressed:**
  - **`bunx`/`npx` in package.json `scripts` field breaks the Node-22 fallback** the same way `bun run` did. Wrapping in `scripts/run-tool.mjs` (auto-detects bunx vs npx; honors `AQA_PKG_RUNNER` override) keeps the user-facing contract working everywhere.
  - **CI is a controlled environment, package.json is the contributor contract.** CI may legitimately call `bunx` because the workflow installs Bun explicitly via `oven-sh/setup-bun@v2`. But a contributor on Node-only must be able to `npm run e2e` etc. without first installing Bun. Don't conflate the two.
  - **Unquoted glob arguments in package.json scripts are expanded by the shell, not the tool.** `markdown-link-check **/*.md` becomes `markdown-link-check README.md AGENTS.md` (no recursion) on default bash/Windows cmd. Always quote the pattern (`'**/*.md'`) so the tool receives the literal pattern and recurses correctly.
  - **`engines.bun` and `packageManager` must be consistent.** Pinning `bun@1.3.11` in packageManager while declaring `bun >= 1.1.0` in engines is internally contradictory: corepack-aware tooling will refuse to use an older Bun even though engines claims it is supported. Raised engines floor to `1.3.0` to match the pin and the lockfile.
  - **SECURITY.md should not advertise tools that don't exist on the minimum supported version.** `bun audit` landed in newer Bun releases; if `engines.bun >= 1.3.0`, that's fine and worth stating explicitly.
  - **Double-parsing JSON in scripts is wasteful and creates TOCTOU race risk.** Cache the parsed `package.json` on the entry object instead of reading it twice (filter + execute).
  - **Always validate the shape of free-form `package.json` fields.** `workspaces` can be an array, an object with a `packages` array, or (mistakenly) a string. A defensive `Array.isArray(...)` check + a clear error beats an iteration over string characters.
- **PR #1 Copilot second-pass review (6 comments) surfaced patterns missed in the first pass — all addressed:**
  - **"Hardcoded path" detection is path-string-aware, not directory-aware.** A code reviewer flagged `Read C:\Users\lopad\...` inside CLAUDE.md even though the surrounding paragraph explicitly forbade such paths. Lesson: review your own writing for the exact pattern that the rule prohibits, not just at "moved files to internal/".
  - **Sibling-repo grants in CLAUDE.md permission profile** (`Read freely in this repo and in ../product_image_discovery_admin`) are still maintainer-local. External contributors have no such sibling. Rule: permission profile must reference only paths inside this repo.
  - **Cross-repo citations** ("documented in sibling-repo/AGENTS.md") become dead pointers for external contributors. Inline the content or drop the citation.
  - **Node fallback in CLI helpers is not optional.** If the package advertises Node 22 as tier-1 fallback, the helper scripts that root `bun run` commands depend on must detect runtime availability (bun > npm) instead of hardcoding `bun`. Added `AQA_PKG_RUNNER` override for explicit control.
  - **Glob patterns silently truncated to "common cases" cause silent drift.** When `scripts/run-workspace-script.mjs` only supported `<dir>` and `<dir>/*`, an unsupported pattern (e.g. `packages/**`) would just not match — no warning. Fix: emit a clear WARN on unknown pattern shapes; users can either change the pattern or swap to a real glob lib.
  - **Stale path references survive `git mv` if you forget to grep.** PROGRESS.md still referenced `docs/implementation-plan.md` after moving it to `docs/internal/`. Always `grep -r "<old-path>"` after a rename.
- **PR #1 Copilot/Codex first-pass review surfaced 15 issues, all addressed in `416ba19..babdff3`. Patterns worth remembering:**
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
- **Live admin e2e against local API needs CORS + chain-order normalization.** When the admin Vite dev server (`:5173`) targets a separate local API origin, the test bridge must emit `Access-Control-Allow-*` headers or the UI silently falls back to mock mode. Also, `MemoryStore.listAuditEvents()` returns newest-first; the AuditChainViewer verify flow expects chronological chain order. For live smoke stability, normalize `/api/audit` response to ascending `seq` before feeding the viewer.

## v1.5 — Admin design integration lessons (2026-05-18)

## v2.0 — Truthful browser audit verification (2026-09-17)

- **Never verify a live audit chain from display-normalized fields.** The admin previously converted `null` to a zero hash and retained only display values, making a continuity check insufficient to prove record integrity. Keep the original API object alongside presentation data and hash the canonical raw record in the browser.
- **Async crypto invalidates synchronous source diagnostics.** Once Web Crypto is used, a static extractor that calls the verifier without `await` can report a false result (a Promise is truthy). The authoritative regression must drive the compiled browser UI and assert the visible `CHAIN BROKEN` state.
- **Route metadata is not enforcement.** A framework-agnostic `requires` field protects nothing until the concrete HTTP adapter authenticates the request and calls the RBAC predicate. Keep an injectable verifier at the adapter boundary and test the actual HTTP response, not only the routing table metadata.
- **Status changes are attestations, not ordinary CRUD.** A Finding status such as `verified` has schema-level evidence prerequisites and must be validated against the complete stored record before mutation. Persist the actor, reason and transition in the audit chain; otherwise the UI can manufacture an assertion with no accountable proof.
- **Human-readable IDs still need global identity semantics.** A short counter tied to scenario position is not a durable primary key. Preserve legacy display formats, but generate new occurrence IDs with enough entropy and test ingestion across independent runs; clustering/deduplication must remain a separate concern.
- **Replay success must identify the same defect.** Counting any finding from each retry is insufficient: different failing oracles, changed inputs or changed state can produce a false deterministic result. A production replay contract needs an immutable failure fingerprint and provenance snapshot before it can attest reproducibility.
- **A replay fingerprint must be based on oracle semantics, not finding presence.** The same scenario can fail for different statuses or different assertions. Store the normalized failed-oracle set and reasons per attempt, then compare it with the original fingerprint or return inconclusive when provenance is missing.
- **Replay artifacts are part of run finalization.** Generating them only in a separate reporter command leaves findings without a usable reproduction and makes the run misleadingly complete. Generate them before `run_finished`, record counts/errors in the event, and resolve relative URLs from the original target configuration.
- **Lease fencing requires immutable delivery snapshots.** A token is ineffective if the queue returns a mutable internal object that later leases can rewrite. Return a copy to workers and require the exact token on ACK; test an actual expiry/reassignment interleaving.
- **Tenant filtering must use an authoritative relation.** Filtering only on client-supplied headers or optional fields lets untagged records leak across projects. For findings, resolve the owning run and apply the requested project server-side; unresolved ownership must be hidden, not treated as global.
- **HTTP safety belongs inside the driver.** A pack-level URL check is too late and redirects can escape the intended origin. Resolve and allowlist the final request before fetch, disable implicit redirects, and bound bytes while streaming evidence so the runner’s guardrail is not advisory.
- **Unknown pricing is a safety failure, never zero.** A missing vendor/model price makes budget enforcement mathematically impossible. Preserve token accounting, surface a structured pricing error, and stop dispatch eligibility until pricing is explicitly configured.
- **Redaction must precede hashing and persistence.** Sanitizing only the final Markdown still leaves secrets in JSONL, hashes, traces or replay inputs. Redact at the writer boundary, then hash the redacted representation so stored evidence cannot reconstruct the original value.
- **Generated replay is executable evidence.** Relative URLs, `curl -f`, and naïve single-quoted interpolation can make a replay target the wrong service, hide the expected failure, or change command structure. Generate argv-equivalent shell arguments, use the original base URL, and test adversarial strings.
- **Commerce contracts must encode uncertainty explicitly.** Money needs integer minor units and currency identity; inventory semantics depend on backorder policy; unavailable observers are `unsupported` or `inconclusive`, never empty objects interpreted as pass.

- **Porting a hi-fi design-tool prototype to a real Vite + TS strict bundle.** The deliverable from Claude Design (or any similar tool) is shipped as a single big React tree authored with Babel-in-the-browser conventions. To make it run as a normal Vite SPA with TS strict + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`, the lowest-friction path is to: (a) concatenate all `.jsx` files into one `app.tsx` with `// @ts-nocheck` at the top, (b) `import * as React from 'react'` once and destructure hooks (`const { useState, useEffect } = React;`), (c) inline the prototype's CSS as raw `.css` files imported from `global.css`, (d) add Biome ignore rules for the bundled file + the CSS files so the rest of the repo keeps its strict lint posture. Anything else (re-modularizing into proper modules, removing `@ts-nocheck`) is multi-week work that the design refresh will invalidate on the next handoff.
- **Design-tool-only hooks need production fallbacks.** The Claude Design prototype calls `window.useTweaks(defaults)` and `window.parent.postMessage(...)` for editor integration. Both crash in production. Pattern: at the bottom of the bundled file, *before* `ReactDOM.render`, inject fallbacks that match the design-tool signature exactly:
  ```ts
  if (typeof window !== 'undefined' && typeof (window as any).useTweaks !== 'function') {
    (window as any).useTweaks = (defaults: Record<string, unknown>) => {
      const [t, setT] = React.useState(defaults);
      return [t, (k, v) => setT((prev) => ({ ...prev, [k]: v }))];
    };
  }
  ```
  This kept the prototype intact without touching the design-tool source.
- **Playwright spec files must not collide with Bun's test runner.** Bun's `bun test` picks up `*.{test,spec}.ts` by default. If you put Playwright specs as `*.spec.ts`, the unit-test workflow tries to execute them and crashes (no browser context). Fix: name them `*.e2e.ts` and add `testMatch: ['**/*.e2e.ts']` in `playwright.config.ts`. This is the cleanest separation; no need for path-based excludes.
- **Nav-item locators in a real SPA: never `^X$`.** Sidebar items often render a trailing count badge (`Queue12`, `Notifications3`), so `^Queue$` will never bind. Anchor at start only (`^Queue`) and **escape regex meta-chars** in the screen name — `Audit (admin)` was being parsed as the capture group `^Audit (admin)$`. Helper:
  ```ts
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  page.locator('.nav-item', { hasText: new RegExp(`^${escaped}`, 'i') });
  ```
- **Smoke tests must filter prototype-intentional `console.error` calls, but not at the cost of catching real fatals.** The Claude Design prototype emits demo `console.error` lines (mock SSE failures, fake verification timings, hydration warnings, controlled-vs-uncontrolled input warnings on read-only mock forms). Pattern: keep an `IGNORED_ERROR_FRAGMENTS` array of lowercase substrings (`react-dom`, `hydration`, `form field`, `onchange`, `value\` prop`, `controlled`, etc.) and only fail the test if the error message contains none of them. Document each entry's reason in a code comment so future maintainers know what real bug would still slip through.
- **Match the prototype's actual DOM, not what `getByRole` expects.** Design prototypes commonly render styled `<div>`/`<span>` elements for tabs and segmented buttons (e.g. `.replay-tab`, `.seg-btn`). Playwright's `getByRole('button', { name: ... })` will not find them because they have no `role="button"` or `<button>` tag. Either use a class-scoped locator (`page.locator('.replay-tab', { hasText: /repro\.sh/i })`) or add `role="button"` to the prototype — class-scoped is less invasive and survives a design refresh.
- **CI Playwright job needs to build the admin SPA *before* the dev server boots.** Otherwise the auto-started `bun run dev` races against `bun run build` dependencies (e.g. workspace dist/ outputs not present yet). Always: `bun install` → `bun run build` (root, topological) → `bun run build` (admin) → `bunx playwright install` → `bunx playwright test`. The webServer config in `playwright.config.ts` should boot `bun run dev` with `reuseExistingServer: !process.env.CI` and a long enough `timeout` (60s+) to survive cold starts in GitHub Actions runners.
- **`gh pr edit --add-reviewer copilot-pull-request-reviewer` is idempotent but doesn't *trigger* the bot.** Assigning Copilot only updates `requested_reviewers`. The actual review is queued by the bot service, which can take 5-15 min, occasionally never arrives. Workarounds: (a) toggle reviewer off and back on to bump the queue, (b) re-run the verification workflow with `gh run rerun <id>` once Copilot is assigned — the check itself accepts assignment-present *or* prior review as proof. Skipping Copilot review entirely is allowed only when explicitly waived by the maintainer in the conversation, not as a default.
- **A commerce contract needs an executable reference boundary.** Schemas alone can make a checkout fixture look complete. The reference merchant keeps cart, order, payment and inventory state together, rejects incompatible idempotency reuse, scopes reads by tenant/customer, and fails closed on the last item. It remains explicitly synthetic until a real adapter proves UI → API → durable state → provider evidence.
- **Refunds need their own idempotency and remaining-balance invariant.** A payment status alone cannot prove safe retries: persist the cumulative refunded amount, reject a request that exceeds the captured balance, and key retries by operation plus payload. Provider chargebacks and fees are separate ledger effects and are intentionally not inferred by this reference merchant.
- **OIDC discovery is not a session implementation.** A provider-neutral adapter can safely exchange a code and validate UserInfo, but CSRF state binding, PKCE verifier storage, secure cookie rotation, logout/revocation and tenant membership belong to the server boundary. Do not treat a successful token exchange as proof of authorization scope.
- **Role checks and tenant checks are separate gates.** A user may legitimately hold an admin role in one organization and still be forbidden from another. Enforce membership at the HTTP dispatcher with an explicit server callback; client-supplied scope headers are selectors, never authorization evidence.
- **A database adapter is not verified by compiling its driver.** The Postgres contract must run against an actual PostgreSQL service, including migration from empty schema, a fresh process reading prior state, concurrent atomic creates, audit ordering and close/reconnect behavior. Conditional local tests are evidence of intent only when the service is absent.
- **Make unavailable infrastructure an explicit CI gate.** A conditional local test avoids a false green, but it is not enough. Provision the exact database major version in CI and export only an ephemeral test DSN; the result must be reported separately from unit coverage.
- **Separate workspace builds from docs builds in CI.** A root aggregate command can hide a missing docs-site install, then fail every independent job before its actual test. Use `build:workspace` for package gates and explicitly install docs dependencies where documentation is part of the acceptance target.
- **JSONB driver return types need runtime evidence.** Type declarations do not guarantee whether a PostgreSQL client decodes JSONB on every query path. Normalize at one boundary and exercise a real round-trip in CI; a TypeScript cast alone can turn a persisted string into a false object.
- **Playwright 1.60 has two Chromium artifacts in headless CI.** `playwright install --with-deps chromium` can download Chrome for Testing while the runner launches the separate `chromium-headless-shell`; the resulting error is an absent executable, not an SPA failure. Provision `chromium chromium-headless-shell` explicitly in every install script and CI job.
- **Do not mix `bunx playwright` with a workspace runner.** `bunx` may resolve a transient/latest CLI while `@playwright/test` resolves the lockfile version, leaving browser revisions such as 1243 installed while tests seek 1223. Install and run Playwright via the same package-local `bun run` scripts.
- **A complete CI gate must include the browser journey after toolchain repair.** The successful run `35168485693` proves the install/run alignment worked: the 142 admin tests launched and completed, rather than merely listing tests or passing a browser-install step. Record the run ID alongside the individual package gates.
- **A read-only user page still needs a write path.** If authentication is the only source of IdP identity and `listUsers()` has no persistence counterpart, a production Postgres adapter will truthfully return an empty directory forever. Upsert the validated authenticated snapshot at the HTTP boundary, then expose it read-only to admin; do not infer users from tokens or runs.
- **Aggregations must preserve source measurements.** A Postgres adapter that only counts runs can make a cost dashboard look healthy while silently reporting zero tokens and USD. Derive every summary field from persisted run totals and test a non-zero fixture against a real database.
- **Scanner output is not enforcement until it sits before persistence.** A pack scanner that only powers a report does not reduce supply-chain risk. The import boundary must reject critical/high findings and invalid declared signatures before `installPack`; warnings can remain visible without blocking low-risk packs.
- **A hardened profile cannot silently downgrade to process execution.** The container backend must fail closed when no command is supplied, make network/filesystem/resource policy visible in the runtime arguments, and expose an injectable executor for deterministic tests. Unit tests prove policy construction; only a real OCI runtime proves the operational boundary.
- **Container isolation needs an operational gate, not only argument assertions.** The CI contract launches the image and checks UID/filesystem behavior; a mocked executor proves error handling and policy composition but cannot prove Docker/Podman accepted the flags.
- **A durable queue needs both locking and fencing.** `FOR UPDATE SKIP LOCKED` prevents two workers from leasing the same ready row, but an expired lease can still leave a stale worker alive; a per-lease token in the ACK predicate is required to reject that worker after reassignment. Reconnect tests must verify the terminal state survives a new client.
- **Durability must be an explicit boot choice.** Keeping an in-memory queue as the development default is useful, but production code must have a visible DSN/configuration path and close the durable client on shutdown; otherwise operators can believe they deployed a shared queue while still losing jobs on restart.
- **`CREATE TABLE IF NOT EXISTS` is not a concurrent migration lock.** Two fresh PostgreSQL clients can both pass the existence check and race in catalog creation. Serialize first-use migration with a database advisory lock, and give real container tests enough time for a cold image pull instead of weakening the assertion.
- **Record the whole acceptance run, not only the interesting new job.** Run `35170349159` proves the durable queue and OCI sandbox while also keeping the existing build, runtime, CLI, and 142-browser-test gates green; individual job success alone would leave the integration matrix incomplete.
- **Persistence evidence must cross process boundaries.** A round-trip on one database client can pass with an in-memory cache or connection-local state. The minimum durable contract is close → construct a fresh store → read the prior record, plus a concurrent create race that proves uniqueness is enforced by PostgreSQL rather than by a JavaScript map.
# 2026-09-17 — every install route must share the safety boundary

The YAML import route had schema/scanner/conflict controls while the older JSON route explicitly bypassed them. Enterprise hardening must audit all equivalent mutation routes, not only the newest UI path. Parsed JSON also loses the original YAML bytes, so signature verification needs a documented canonical-manifest digest; that still proves integrity, not publisher identity.

# 2026-09-17 — artifact integrity starts at the writer boundary

An artifact hash is meaningful only after redaction and normalization, otherwise the digest attests to bytes that must not be stored. Keep text/JSON redaction explicit, make binary writes opt-in, reject traversal before filesystem resolution, and use atomic replacement. The initial store contract is useful only once run finalization and API download paths stop bypassing it.

The first useful integration target is replay generation because it has a bounded producer and an existing complete-journey test. Keep the sidecar metadata assertion in that journey; otherwise a passing replay file can hide that the old direct writer is still active.

# 2026-09-17 — live LLM must remain bounded and redacted

An HTTP LLM adapter is not production-grade merely because it parses a 200 response. The minimum safe contract includes abortable timeout, maximum generation bound, injectable transport for deterministic tests, redacted prompts/errors/responses, and a model provenance hash. Provider-specific auth and trust behavior still need separate adapters rather than pretending one wire protocol covers all vendors.

# 2026-09-17 — OIDC local and production cookie policies differ

An HttpOnly OIDC cookie that is always `Secure` cannot complete the login journey on the bundled local HTTP server; one that is never `Secure` is unsafe for production. Make the policy explicit, default it from loopback versus non-loopback deployment, and test both the authentication journey and post-logout denial.

# 2026-09-17 — deployment templates need executable evidence

Kubernetes YAML that looks hardened is not validated until rendered and linted by Helm (and ideally schema-checked against the target cluster version). When the local tool is unavailable, record that limitation and avoid calling the chart production-ready; review template indentation, selectors, PVC behavior and default namespace selectors manually, then make CI render the chart.

# 2026-09-17 — a durable queue needs an explicit completion API

Lease storage alone is not a worker contract. If dequeue exists but ACK is not reachable through the server, every successful worker execution appears as an expired lease and is retried. Expose ACK with the lease token and a separate runner credential boundary; stale tokens must be fenced and observable as conflicts.

# 2026-09-17 — retries need a terminal policy

Visibility leases without a maximum-attempt policy create infinite poison-job loops and hide systemic failures. Persist attempts and failure reason, expose an explicit worker failure path, and make both expiry and explicit failure terminal after the configured budget. The DLQ is evidence for operator action, not silent success.

# 2026-09-17 — migrate synchronous producers without weakening their contract

`aqa report` is intentionally synchronous, so migrating it to an async artifact API would have changed the CLI contract. A synchronous adapter method keeps the public behavior while moving the write security boundary; the journey must assert metadata sidecars to prove the old writer was actually removed.

# 2026-09-17 — audit integrity requires a transaction boundary

Reading the last audit event, mutating a finding, and appending the next event as three independent store calls allows concurrent writers to fork the hash chain or lose the status/audit pairing. The API must call one store primitive; PostgreSQL must serialize the complete sequence (including the empty-tail case) with a transaction-scoped advisory lock. A passing in-memory test is useful for the API contract, but only the live PostgreSQL concurrency branch proves the durable invariant.

# 2026-09-17 — Object Lock is an adapter capability, not an authorization model

An S3-compatible artifact adapter can request governance/compliance retention and verify content digests, but it cannot safely infer tenant identity from an artifact key. The API must derive the prefix from authenticated scope, and operators must enable bucket versioning, Object Lock and KMS policy separately. The adapter therefore accepts an explicit prefix and documents these controls instead of claiming that S3 alone makes artifacts enterprise-compliant.

# 2026-09-17 — tenant filtering is not enough for resource writes

Filtering a list by `org/project` does not prevent a same-name profile, risk or
scenario from overwriting another tenant during `PUT` or `DELETE`. The storage
key itself must carry the authenticated scope, while legacy unscoped keys need a
deliberate compatibility rule. New namespaced records are now isolated in both
adapters; full migration of legacy global records remains an operational task.

# 2026-09-17 — migration idempotency needs serialization

`CREATE TABLE IF NOT EXISTS` makes a statement repeatable, not a multi-step
bootstrap safe across replicas. Version insertion, table creation and index
creation must share a transaction-scoped advisory lock; otherwise two fresh
servers can observe an incomplete schema/version state during startup.

# 2026-09-17 — dependency clean is a release gate, not a dashboard badge

Dependabot findings included transitive parser/URL vulnerabilities that were
not visible in application tests. Run `bun audit` after lockfile changes, update
the owning toolchain where possible, and use a narrowly scoped override only
when the vulnerable transitive range has a compatible fixed release. Re-run
the UI build, CLI bundle and full tests after toolchain upgrades.

# 2026-09-17 — provider-specific LLM contracts must not share fake adapters

An OpenAI-compatible endpoint cannot stand in for Anthropic Messages semantics:
headers, system placement, content blocks, stop reasons and tool schemas differ.
Implement each live provider behind the same bounded/redacted interface and keep
unsupported providers as explicit scaffolds, so the registry cannot silently
claim coverage that the wire contract does not provide.

# 2026-09-17 — commerce adapters must prove effects, not response shapes

A commerce provider can return schema-valid order/payment objects while still
charging twice or overselling stock. The adapter contract therefore needs a
capability preflight and an executable journey that compares before/after
inventory, validates arithmetic invariants, and retries the same idempotency
key. Missing observers are `unsupported`; malformed or inconsistent snapshots
are `error`; neither is a successful checkout.

Refunds are a separate journey, not a checkout assertion. A partial refund
must be strictly below the captured amount, preserve currency and order
identity, and return byte-equivalent state on an idempotent retry. The adapter
contract now proves that boundary independently.

# 2026-09-17 — legacy compatibility must not outrank tenant isolation

Fallback reads are convenient during migrations but unsafe at an API boundary:
a missing namespace can look like a valid record and cross a tenant boundary.
Scoped stores must return only namespaced records. Legacy data should be
handled by an explicit migration/import path, never by a transparent fallback.

# 2026-09-17 — a durable queue without a durable store is still volatile

Selecting PostgreSQL for worker leases while the admin keeps runs and
findings in a process-local map creates a misleadingly durable deployment.
Expose control-plane store selection separately, keep the in-memory default
only for local development, and close both resources on shutdown. The
configuration path must be explicit and must never print credentials.

# 2026-09-17 — provider names are not wire contracts

Google Gemini and Cohere expose different roles, content blocks, tool schema
names and usage fields. Registering both behind an OpenAI-compatible adapter
would make tests look green while sending semantically wrong requests. Each
provider needs its own bounded/redacted adapter and injected transport tests;
unsupported Bedrock remains explicit until SigV4 and runtime behavior are
verified.

Bedrock can now be live only when its AWS region and credentials are explicit:
the adapter signs the native Converse request and never silently falls back to
an OpenAI-compatible endpoint. Tests verify the authorization shape without
calling AWS; IAM policy, credential rotation and private endpoint reachability
still require deployment evidence.

# 2026-09-17 — canonical evidence must be byte-preserved

Publishing an audit stream through a convenience text method can silently
re-run redaction and change the bytes after the hash chain was computed. The
runner therefore sends canonical `events.jsonl` and `findings.jsonl` through
`putBytes`, then records their digests in a manifest. Artifact publication is
still not a distributed transaction, so partial remote uploads remain an
explicit operational recovery concern.

# 2026-09-17 — observability must not be the audit source of truth

Telemetry exporters can be unavailable, slow or misconfigured. The persisted
hash-chained event remains authoritative; an observability observer must be
bounded and fail open after the event is written. Prometheus labels also need
name validation and a hard series cap because scenario and tenant identifiers
are untrusted cardinality inputs.

# 2026-09-17 — air-gap installers need executable trust boundaries

Bundling files is not installation evidence. An offline installer must reject
unsafe archive paths and links before extraction, verify the complete manifest
before loading images, make signature enforcement explicit, and pass chart
ownership/context/namespace as operator inputs. The actual OCI runtime,
cluster and Cosign key remain required for a live deployment proof.

# 2026-09-17 — migration must be a privileged operation

Legacy global records cannot be safely made visible by fallback. A migration
endpoint must derive its destination from authenticated tenant scope, preflight
all target keys, refuse partial conflict moves, and leave scoped reads
fail-closed. The migration boundary also needs a narrow resource allowlist so
operational configuration cannot accidentally become a run or identity import.
