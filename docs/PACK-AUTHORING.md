# Pack authoring guide

> Audience: anyone who wants to write a new pack — for their own project, their team, or the community. Reading time: 15 min. Prereq: a working `@aqa/kit` install (`aqa --version` prints something).

A **pack** is a unit of QA knowledge: a manifest, a list of risks, a list of scenarios that prove those risks, plus the oracles + probes the scenarios need. The kit ships five baseline packs (`pack-core`, `pack-api-core`, `pack-web-ui`, `pack-llm-agent`, `pack-security`), and the community is invited to write more.

## TL;DR

A pack is a directory with this layout:

```
my-pack/
├── pack.yaml              # the manifest (always required)
├── package.json           # only if you intend to publish to npm
├── scenarios/*.yaml       # the actual test cases
├── risks/*.yaml           # the rules of the world your scenarios prove
├── oracles/*.yaml         # extra oracle definitions (optional)
└── probes/*.yaml          # extra probe definitions (optional)
```

Drop it under `<your-project>/packs/my-pack/`, reference `my-pack` from `.aqa/profiles.yaml`, and `aqa run` will pick it up. To share it across projects, the recommended path today is publishing under the `@aqa` scope on npm (`@aqa/pack-myname`) since the default discovery scans `<project>/node_modules/@aqa/*` automatically. Non-`@aqa` scopes work too but currently require an alias install or an explicit `packsRoot` — see "How `aqa run` resolves your pack" below for the constraints.

## The manifest (`pack.yaml`)

Every pack must have a manifest at its root. The schema lives in [`@aqa/schemas/PackManifest`](../packages/schemas/src/pack-manifest.ts) and looks like this:

```yaml
schema_version: "1"
name: pack-my-thing          # Slug — lowercase, alphanumeric, dashes
version: 0.1.0               # SemVer
description: "What this pack proves, in one sentence."
author: "Jane Hacker"
license: Apache-2.0          # default; override if you must
homepage: "https://..."      # optional

# applies_when filters this pack at run time. `aqa run` will skip the
# pack if ANY field is set and doesn't match the project. Omit a field
# to mean "match anything".
applies_when:
  sut_type: [api]                                    # api | web | cli | lib | agent | pipeline
  framework: [hono, express, fastify, koa, nestjs]   # only if you care
  runtime: [bun, node]                               # only if you care
  db: [postgres, mysql]                              # only if you care
  tags_any: [public-api]                             # ANY of these tags
  tags_all: [billing, prod]                          # ALL of these tags

# Files that belong to this pack. All paths are relative to pack root
# and MUST stay within it (no `..`, no absolute paths, no symlinks
# escaping — the run command rejects these as unsafe).
templates: []                # optional starter snippets
scenarios:                   # the unit of work
  - scenarios/idempotency.yaml
  - scenarios/auth-token-replay.yaml
risks:                       # what could go wrong
  - risks/my-thing.yaml
oracles: []                  # custom oracles (rare — usually use built-ins)
probes: []                   # custom probes (rare — usually use built-ins)

# Optional cryptographic signing for trusted packs.
signing:
  sha256: "<hex digest of canonicalized manifest>"
  sigstore_bundle: "<base64 sigstore attestation>"
```

`name`, `version`, `description`, and `author` are required. `license` defaults to `Apache-2.0`. Everything under `applies_when` is opt-in; omit a field and that filter doesn't apply.

## Scenarios

A scenario is one test. It declares the risks/invariants it proves, the **probes** to execute, and the **oracles** that decide pass/fail. Here's a complete idempotency scenario from `pack-api-core`:

```yaml
schema_version: "1"
id: scn-idempotency
title: Repeating a POST with the same Idempotency-Key must not create a duplicate
risk_refs: [r-idempotency]                   # link back to risks/api.yaml
invariant_refs: [inv-idempotent-post]
preconditions:
  - "user authenticated"
steps:
  - id: probe-post-1
    kind: http
    with:
      method: POST
      url: /items
      body: { name: "x" }
      headers: { "Idempotency-Key": "abc-123" }
  - id: probe-post-2
    kind: http
    with:
      method: POST
      url: /items
      body: { name: "x" }
      headers: { "Idempotency-Key": "abc-123" }
oracles:
  - id: o-same-id
    kind: response_contains
    # Today the built-in `response_contains` evaluator does a substring
    # match against every probe response body — `with: { value: "<needle>" }`.
    # The jsonpath/equals shape used by some bundled scenarios is a
    # documented extension for a future evaluator; only `value` is wired up
    # in @aqa/runner.builtInOracles today.
    with: { value: "abc-123" }
tags: [api, idempotency]
```

`steps` is an ordered list of probes. Each probe has an `id`, a `kind` (today: `http`), and a `with` payload of HTTP method/url/body/headers. The probe runner executes them in order and records the responses.

`oracles` is an ordered list of pass/fail checks evaluated against the recorded probe results. The kit ships three built-in oracle kinds in `@aqa/runner.builtInOracles`:

- `http_status` — assert the last probe's response status matches `expected` (integer). `with: { expected: 200 }`.
- `response_contains` — substring match on every probe's serialized response body. `with: { value: "<needle>" }`. Returns pass when **any** probe's body (as `JSON.stringify`) contains the needle.
- `response_not_contains` — the negative; pass when no probe's body contains the needle.

A jsonpath form with back-references like `@probe-post-1.body.id` appears in some bundled scenarios as documentation of intent — that evaluator is **not** implemented today, so a `response_contains` step relying on it will always pass (the `value` field is undefined, and empty-string is a substring of everything). Track-or-implement jsonpath support is a follow-up; for now use the substring form.

`tags` decide which profile picks the scenario up. `aqa run --profile smoke` only executes scenarios whose `tags` intersect `profile.tags` (or every scenario, if `profile.tags` is empty).

## Risks

A risk file says "here's something that could go wrong, and the invariant that says it didn't". Risks are referenced from scenarios via `risk_refs` and `invariant_refs`:

```yaml
schema_version: "1"
project: pack-my-thing
risks:
  - id: r-idempotency
    category: integrity
    title: Repeated POST creates duplicate resources
    severity: high
    likelihood: likely
    invariants:
      - id: inv-idempotent-post
        statement: |
          Resending the same Idempotency-Key returns the same resource
          (no duplicate row in storage).
```

`category` is one of the values defined by [`RiskCategory`](../packages/schemas/src/risk-map.ts) in `@aqa/schemas`: `auth | data | integrity | availability | confidentiality | integration | business_logic | ui_ux | compliance | agentic`. `severity` is `info | low | medium | high | critical`. `likelihood` is `rare | unlikely | possible | likely | almost_certain`.

## The minimum viable pack

The smallest useful pack is one manifest + one risk + one scenario. Here's a complete `pack-healthcheck` you can copy:

```
pack-healthcheck/
├── pack.yaml
├── risks/baseline.yaml
└── scenarios/health.yaml
```

`pack.yaml`:
```yaml
schema_version: "1"
name: pack-healthcheck
version: 0.1.0
description: One-shot health endpoint check.
author: You
applies_when:
  sut_type: [api]
templates: []
scenarios: [scenarios/health.yaml]
risks: [risks/baseline.yaml]
oracles: []
probes: []
```

`risks/baseline.yaml`:
```yaml
schema_version: "1"
project: pack-healthcheck
risks:
  - id: r-healthcheck
    category: availability
    title: Health endpoint is unreachable
    severity: medium
    likelihood: possible
    invariants:
      - id: inv-health-ok
        statement: GET /healthz returns 200 within 1s.
```

`scenarios/health.yaml`:
```yaml
schema_version: "1"
id: scn-healthcheck
title: GET /healthz returns 200
risk_refs: [r-healthcheck]
invariant_refs: [inv-health-ok]
preconditions: []
steps:
  - id: probe-health
    kind: http
    with: { method: GET, url: /healthz }
oracles:
  - id: o-200
    kind: http_status
    with: { expected: 200 }
tags: [api, health]
```

## Testing your pack locally

Three ways, in order of friction:

### 1. Drop it under `<project>/packs/`

```bash
cd ~/work/my-project
mkdir -p packs/pack-healthcheck
# ... copy the three files above into packs/pack-healthcheck/ ...
```

Then add the pack to a profile in `.aqa/profiles.yaml`. Note both the top-level `schema_version` AND the per-profile `schema_version` + `execution_mode` are required by `@aqa/schemas/ProfilesFile`:

```yaml
schema_version: "1"
profiles:
  smoke:
    schema_version: "1"
    name: smoke
    execution_mode: orchestrator
    packs: [pack-healthcheck]      # the manifest `name` field
    tags: [api, health]             # any tag the scenario carries
```

Now `aqa run --profile smoke` should report `scenarios: 1`.

### 2. As an npm-installed package

**Current limitation:** `aqa run`'s default discovery only scans `<project>/node_modules/@aqa/*`, not arbitrary scopes. If you publish your pack as `@your-scope/pack-healthcheck`, consumers must either (a) place a copy under `<project>/packs/pack-healthcheck/` for now, (b) install it under the `@aqa` scope name on disk (e.g. via `package.json` `"@aqa/pack-healthcheck": "npm:@your-scope/pack-healthcheck"`), or (c) pass an explicit `packsRoot` to programmatic `runRun({ packsRoot: [...] })`. Broader scope discovery is tracked as a v1.7.x follow-up.

For the `@aqa` scope itself the install is automatic:

```bash
npm install --save-dev @aqa/pack-foo   # any pack under the @aqa scope
```

`aqa run`'s `defaultPacksRoot()` discovers it from `<project>/node_modules/@aqa/pack-foo/` as long as that directory contains a `pack.yaml`. The directory name does **not** have to start with `pack-` — only the manifest's `name:` field matters.

Required `package.json` (minimum):
```json
{
  "name": "@your-scope/pack-healthcheck",
  "version": "0.1.0",
  "files": ["pack.yaml", "scenarios", "risks", "oracles", "probes"]
}
```

`files:` is what tells npm which directories to include in the published tarball. Don't ship `node_modules/` or your dev tooling.

### 3. As a workspace pack (monorepos)

If you're inside a monorepo that already uses `@aqa/kit`, drop the pack under `packs/pack-name/` at the repo root. `aqa run` discovers `<project>/packs/*` before `node_modules/`.

## Programmatic validation

Before publishing, validate your manifest against the schema:

```bash
bunx zod-validate @aqa/schemas/PackManifest pack.yaml
# or just run aqa run — it parses every manifest with Zod and reports
# any field violations as run errors.
```

## How `aqa run` resolves your pack

When you type `aqa run --profile smoke`, the kit walks these locations in order and stops at the first hit per manifest `name`:

1. `<project>/packs/*/pack.yaml` (monorepo / vendored)
2. `<project>/node_modules/@aqa/*/pack.yaml` (npm-installed)
3. `dist/packs/*` inside the running `@aqa/kit` install (the five bundled packs)

For each pack it finds, it applies `applies_when` against the project context (`sut_type`, `runtime`, `framework`, `db`, `tags` from `.aqa/project.yaml`). Packs that don't match are skipped. For each pack that passes, it reads `manifest.scenarios` (no glob-scanning), parses each one with Zod, filters by `profile.tags` (intersection match), and executes the steps via `@aqa/runner.runScenario`.

## What NOT to do

- **Don't reference scenario files outside the pack root.** Absolute paths and `..` traversal in `manifest.scenarios` are rejected as unsafe (path-traversal guard). Symlinks that escape the pack root are also rejected (symlink guard via `realpathSync`).
- **Don't depend on `aqa/scenarios/*.yaml` loose discovery.** It doesn't exist. Every scenario must be listed in a pack manifest.
- **Don't ship a pack with `scenarios: []` and expect it to run scenarios.** The kit's `pack-core` does this on purpose (it ships risks only, used as a baseline by every profile). A user-authored pack with empty scenarios will be loaded but contribute nothing.
- **Don't reuse `pack-` prefixes you don't own.** If you publish `@your-scope/pack-core`, it WILL collide with the kit's own `pack-core` in dedup (project tier wins). Use a unique manifest `name:` field.

## Publishing checklist

Before `npm publish`:

- [ ] `pack.yaml` validates (try `aqa run` against a project that includes your pack)
- [ ] `name:` field is unique enough to not collide with any baseline pack
- [ ] `version:` follows SemVer; bump for breaking schema changes
- [ ] `description:` is one clear sentence; this is what shows up in pack lists
- [ ] `applies_when:` is as narrow as you can make it; broad packs annoy users
- [ ] every scenario has a `risk_refs` link to a risk you ship in `risks/`
- [ ] every scenario has at least one `oracle` (an unchecked probe is a noop)
- [ ] `package.json` `files:` lists `pack.yaml` + every directory you ship
- [ ] tagged a git release matching `version:` so people can audit the source

## Where to ask questions

- File an issue on [padosoft/agentic-qa-kit](https://github.com/padosoft/agentic-qa-kit/issues) tagged `pack-authoring`.
- For a worked-out reference, read the source of any bundled pack: `packs/api-core/`, `packs/web-ui/`, etc.
- The canonical schema lives in [`packages/schemas/src/pack-manifest.ts`](../packages/schemas/src/pack-manifest.ts) — when in doubt, the Zod definition is the source of truth.
