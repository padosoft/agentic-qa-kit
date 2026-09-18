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
  risk coverage  Show fail-closed risk coverage from persisted run evidence
  dr inventory <file> [--public-key <pem>]
                Validate/hash a backup inventory; verify signed inventories
  dr restore <inventory> <evidence> [--public-key <pem>]
                Validate a restore drill against RPO/RTO and security checks
  dr release-gate <inventory> <evidence> <production-evidence> --public-key <pem>
                Verify signed production evidence is bound to this restore drill

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

Authenticated HTTP probes use named references such as `auth: "${OLD_TOKEN}"`.
Inject values from the host, never from pack files or CLI arguments:

```text
AQA_HTTP_SECRET_OLD_TOKEN=<provided-by-ci-secret-store>
```

Embedding hosts may pass `RunOptions.httpSecrets` instead. Missing references
fail before dispatch and secret values are not persisted in run evidence.

### Agent execution

Profiles with `execution_mode: agent` require an explicit host-owned
`RunOptions.agentRunner`. The runner receives the same bounded probe contract
and cooperative cancellation signal as orchestrator execution; audit events and
findings are marked with agent provenance. The CLI does not choose an LLM,
provider, MCP server, credentials, or tool policy implicitly. Hosts inject
those policies and keep model/trajectory evidence in their integration adapter.

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

Set `AQA_ARTIFACT_S3_REQUIRE_RETENTION=true` in production to fail closed when
the S3 backend is missing both Object Lock retention settings. The run backend
also reads back the applied Object Lock mode/date after each content and
metadata write. This validates the application/provider contract; it does not
provision bucket versioning, KMS or Object Lock itself.

After `run_finished`, the selected store also receives byte-preserved
`canonical/events.jsonl` and `canonical/findings.jsonl`, plus
`canonical/manifest.json` with SHA-256 digests and byte counts. A failed
publication fails the run result; publication is not a distributed transaction
and partial uploads require operational retry or cleanup.

For an independently administered audit domain, callers embedding `runRun()`
can pass a separate `auditCheckpointStore`. The final checkpoint is then
published as `checkpoints/<run_id>.json` and its digest is recorded in the local
manifest. Configure that store with its own tenant boundary, Object Lock/KMS,
backup and restore evidence; the runner does not infer those controls.

The CLI configures the same boundary when all of the following are present:
`AQA_AUDIT_CHECKPOINT_S3_BUCKET`, optional
`AQA_AUDIT_CHECKPOINT_S3_PREFIX`/`AQA_AUDIT_CHECKPOINT_S3_ENDPOINT`,
`AQA_AUDIT_CHECKPOINT_S3_RETAIN_UNTIL`, and
`AQA_AUDIT_CHECKPOINT_S3_RETENTION_MODE=COMPLIANCE`. Partial or non-compliance
configuration fails before the run starts. Credentials still come from the AWS
credential chain and are never accepted as CLI values.

## Durable admin state

`aqa admin` uses `MemoryStore` for local development. Set `AQA_STORE_DSN` to a
PostgreSQL connection string to persist runs, findings, configuration and
audit records across process restarts. Set `AQA_QUEUE_DSN` separately to make
worker leases durable. Both clients are closed during graceful shutdown.

The PostgreSQL service, credentials, TLS policy, migrations and backups remain
operator responsibilities; the CLI does not print the DSN or credentials.

## Disaster recovery evidence

`aqa dr inventory <file>` validates the machine-readable backup inventory used
by the DR runbook and prints only stable identifiers plus the canonical digest.
Signed inventory envelopes require `--public-key`; the CLI will not treat a
signature as trusted without an explicit Ed25519 trust root.

`aqa dr restore <inventory> <evidence>` validates a restore-drill record
against the selected inventory: backup identity, artifact manifest digest,
RPO/RTO objectives and required security checks must all match. This is an
operator evidence gate, not a substitute for actually running PostgreSQL PITR
or object-store restore in an isolated environment.

`aqa dr release-gate <inventory> <evidence> <production-evidence> --public-key <pem>`
validates all three documents, verifies the signed production envelope, and
requires both its restore-drill reference and canonical SHA-256 digest to match
the exact drill record. It fails closed on missing signatures or substitutions.
The command proves evidence provenance and document consistency; it does not
contact PostgreSQL, the artifact provider, KMS or the identity provider.

Host applications can inject a bounded `MetricsRegistry` into `runAdmin` to
expose `GET /metrics` in Prometheus text format. Scraping is opt-in; a
non-loopback bind fails closed unless `metricsAuthorize` is supplied. Metric
labels must remain bounded and payload-free.

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

## Verify a finding after a fix

Use the finding ID from `aqa run` or `aqa report` to replay its scenario against
the real system under test:

```bash
aqa verify <finding-id> --base-url http://127.0.0.1:3000 --attempts 3
```

The command refuses to use the runner's no-network stub, executes the scenario
up to ten times, and writes a redacted verification result beside the original
run artifacts. Exit code `0` means every attempt passed deterministically;
exit code `2` means the replay completed but was flaky or non-deterministic.
This is an evidence-producing replay primitive: it does not silently close the
finding or claim that CI, deployment, or a pull request has been verified.

## Ingest external test and security results

Normalize JUnit or Semgrep-compatible output into redacted AQA evidence:

```bash
aqa ingest junit test-results/junit.xml
aqa ingest sast semgrep.json --tool semgrep
```

The parser is size bounded and rejects XML external-entity declarations. Ingest
does not automatically verify or close findings; policy-controlled linkage is
an explicit later step.

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
