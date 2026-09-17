# ADR-075 — Content-addressed pack integrity

## Status

Accepted — 2026-09-17

## Decision

Pack signing may declare `signing.content_sha256`. The digest is computed from a sorted stream containing the canonical unsigned manifest and SHA-256 entries for every regular file under the pack root, excluding only YAML manifest presentation (`pack.yaml`/`pack.yml`). Symlinks and unsupported file types are rejected. `aqa run` verifies the digest immediately after `loadPack` and before scenario discovery/execution.

## Rationale

Manifest-only integrity does not protect scenario, probe, template or risk files. Binding the whole pack to a deterministic digest closes the mutation gap while leaving publisher identity and transparency-log verification to the Sigstore/cosign follow-up.

## Evidence and limits

- `packages/pack-scanner/test/scanner.test.ts` proves a scenario-file mutation invalidates the digest.
- The field is optional for backward compatibility; unsigned/unpinned existing packs are not retroactively trusted. Keyless certificate identity, Rekor inclusion and revocation policy remain open.
