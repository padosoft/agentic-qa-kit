# ADR-048 — CJS bundle runtime asset paths

## Status

Accepted — 2026-09-17

## Context

The published CLI is a CommonJS bundle, while development commands are emitted as ESM. Resolving bundled packs and the admin SPA through `import.meta.url` creates a packaging trap: esbuild warns that `import.meta` is empty in CJS, and an installed artifact can fail only when it reaches a runtime asset path.

## Decision

Resolve command assets from the running entrypoint (`__dirname` for CJS and the recognized `process.argv[1]` command path for direct ESM execution). Keep fallback resolution bounded to the package `dist/commands` directory. The CJS bundle test rejects residual `import.meta` dependencies.

## Consequences

The artifact no longer relies on an ESM-only primitive and the build emits no `import.meta` warning. The installed CLI still requires a separate complete admin HTTP journey in CI; unit tests and CLI run evidence do not prove a long-lived server lifecycle.

## Evidence

Kit typecheck and 121/123 tests passed (2 platform-dependent symlink skips). A built `dist/cli.cjs` completed `init` and a real `run` journey from a temporary project with 2 scenarios and 2 findings; the CJS artifact contains no `import.meta` token.
