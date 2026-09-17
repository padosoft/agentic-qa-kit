# ADR-174: Verify the installable CLI artifact

## Context

Workspace tests execute TypeScript or the repository's `dist/cli.cjs`. They do
not prove that the publish manifest, tarball file list, bundled assets and
runtime entrypoint still work after installation by a consumer.

## Decision

The CI CLI E2E job now creates the publish-shaped package with
`publish-prep.mjs`, runs `npm pack`, extracts the tarball into an isolated
directory, and executes the extracted CLI for `--version`, `--help`, `init`
and `validate`. The journey rejects remaining `@aqa/*` dependencies and
missing bundled assets.

## Evidence boundary

This proves local tarball integrity and runtime independence from the
workspace. It does not prove publication to GitHub Packages, registry
authentication, a fresh machine's network install, or a real customer
project's provider journey.
