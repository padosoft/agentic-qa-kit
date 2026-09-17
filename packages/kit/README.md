# @aqa/kit

[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](../../LICENSE)
[![cli](https://img.shields.io/badge/cli-aqa-blueviolet)](#cli)
[![status](https://img.shields.io/badge/status-bootstrap-yellow.svg)](../../docs/PROGRESS.md)

> The `aqa` CLI — entry point to the agentic-qa-kit operating system.

## Table of contents

- [What's inside](#whats-inside)
- [Install](#install)
- [CLI](#cli)
- [Junior-friendly quick start](#junior-friendly-quick-start)
- [Project profiler](#project-profiler)
- [Programmatic API](#programmatic-api)
- [Durable artifact backend](#durable-artifact-backend)
- [Durable admin state](#durable-admin-state)
- [Development](#development)

## What's inside

| Layer | Module | Purpose |
|---|---|---|
| CLI | `src/cli/aqa.ts` | `aqa` bin: parses argv, dispatches commands |
| Commands | `src/commands/{init,doctor,validate}.ts` | Each subcommand as a pure function (testable without a TTY) |
| Profiler | `src/profiler.ts` | Detect runtime, package manager, framework, DB, LLM SDKs, test runner, SUT type |
| FS utils | `src/fs-utils.ts` | `writeFileSafe` with overwrite + dry-run semantics |

All commands use `@aqa/schemas` as the source of truth for the artifacts they emit and validate.

## Install

> **Workspace-internal at this stage.** Until v0.1.0 ships, consume via the monorepo:
>
> ```jsonc
> // dependencies
> "@aqa/kit": "workspace:*"
> ```

## CLI

```text
aqa <command> [options]

Commands
  init [name]   Scaffold .aqa/{project,risk-map,profiles}.yaml + testing.md
  doctor        Report kit health (runtime, .aqa, agent docs, validation)
  validate      Validate .aqa/* against @aqa/schemas

Common options
  --force       (init) overwrite existing files
  --dry-run     (init) don't write to disk; print what would happen
  --help        show this help
  --version     show CLI version
```

Exit codes: `0` success, `1` validation failure or unknown command, `2` unhandled error.

## Junior-friendly quick start

```bash
# from your project root
bunx aqa init                 # writes .aqa/* if missing
bunx aqa doctor               # checklist with ✓/⚠/✗
bunx aqa validate             # schema-validate .aqa/* (CI-safe)
```

`aqa init` is **non-destructive**: existing files are left alone unless you pass `--force`. Pair it
with `--dry-run` to preview the writes.

## Durable artifact backend

Runs use the local filesystem by default. For AWS S3, MinIO or another
S3-compatible endpoint, configure the deployment environment before `aqa run`:

```text
AQA_ARTIFACT_S3_BUCKET=aqa-artifacts
AQA_ARTIFACT_S3_PREFIX=tenant/acme
AQA_ARTIFACT_S3_ENDPOINT=https://minio.example.internal   # optional
AQA_ARTIFACT_S3_FORCE_PATH_STYLE=true                    # MinIO commonly needs this
```

The AWS SDK uses its normal credential chain; credentials must never be passed
as CLI arguments or committed. Optional Object Lock requests use
`AQA_ARTIFACT_S3_RETAIN_UNTIL` (ISO timestamp) together with
`AQA_ARTIFACT_S3_RETENTION_MODE=GOVERNANCE|COMPLIANCE`. Bucket versioning,
Object Lock enablement, KMS and tenant authorization remain operator controls.

## Durable admin state

`aqa admin` uses `MemoryStore` for local development. Set `AQA_STORE_DSN` to a
PostgreSQL connection string to persist runs, findings, configuration and
audit records across process restarts. Set `AQA_QUEUE_DSN` separately to make
worker leases durable. Both clients are closed during graceful shutdown.

The PostgreSQL service, credentials, TLS policy, migrations and backups remain
operator responsibilities; the CLI does not print the DSN or credentials.

## Project profiler

`profileRepo(root)` inspects the repo and returns a `ProjectProfile`:

```ts
{
  runtime: 'bun' | 'node' | 'deno' | 'unknown',
  package_manager: 'bun' | 'pnpm' | 'npm' | 'yarn' | 'unknown',
  framework: 'next.js' | 'hono' | 'express' | … | null,
  db: ('postgres' | 'mysql' | 'sqlite' | …)[],
  llm: ('anthropic' | 'openai' | 'google-genai' | …)[],
  test_runner: 'vitest' | 'jest' | 'playwright' | … | null,
  sut_type: 'api' | 'web' | 'cli' | 'lib' | 'agent' | 'unknown',
  has_aqa: boolean,
}
```

Signal sources: `package.json` deps, `bunfig.toml`/`bun.lock`/`pnpm-lock.yaml`/`yarn.lock`, `next.config.*`,
`index.html`, `src/app.ts`/`src/server.ts`, and `pkg.bin`.

## Programmatic API

```ts
import { runInit, runDoctor, runValidate, profileRepo } from '@aqa/kit';

const profile = profileRepo(process.cwd());
const init = await runInit({ root: process.cwd() });
const doctor = runDoctor({ root: process.cwd() });
const validation = runValidate({ root: process.cwd() });
```

Each command is exposed as a single function with explicit options. They do touch disk (writes for
`runInit`, reads for `runValidate`/`runDoctor`/`profileRepo`), but only against the `root` you pass
in — easy to unit-test against a temp directory, no TTY required.

## Development

```bash
bun install
bun run --filter @aqa/kit build
bun run --filter @aqa/kit test
```

The `test` script auto-runs `tsc` via the `pretest` hook so `dist/` is always fresh. Tests use
`node:test` so they run identically under Bun and under plain Node 22 (`--experimental-strip-types`).

## License

Apache-2.0 © Padosoft
