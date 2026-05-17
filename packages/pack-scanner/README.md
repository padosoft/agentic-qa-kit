# @aqa/pack-scanner

Static checks + signature verification for `agentic-qa-kit` packs.

- `scanPack(manifest)` returns issues with severity (critical/high/medium/low).
  Rules at v0.3: unsigned-shell-pack, always-on-shell-pack, signed-pre-1.0,
  templates-without-risks.
- `verifySignature(manifest, rawBody)` checks `signing.sha256` against a
  fresh SHA-256 of the body. cosign / sigstore bundle verification lands at
  v0.4 once the trust-root format settles.
