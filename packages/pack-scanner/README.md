# @aqa/pack-scanner

Static checks + signature verification for `agentic-qa-kit` packs.

- `scanPack(manifest)` returns issues with severity (critical/high/medium/low).
  Rules at v0.3: unsigned-shell-pack, always-on-shell-pack, signed-pre-1.0,
  templates-without-risks.
- `verifySignature(manifest, rawBody)` checks `signing.sha256` against a
  fresh SHA-256 of the body. This is an integrity check, not a Sigstore trust
  decision; cosign/Sigstore bundle verification still requires a configured
  trust root and is a separate deployment gate.
