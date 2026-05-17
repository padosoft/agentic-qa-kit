# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 0.x | ✅ (pre-release; best-effort) |

`0.0.x` releases are governance / bootstrap only and should not be used in production. Support windows for `1.x` and later major versions will be defined when those versions ship.

## Reporting a vulnerability

**Do not file public issues for vulnerabilities** that could be exploited if disclosed.

Use one of these channels:

1. **GitHub Security Advisories (preferred):**
   [Report a vulnerability privately](https://github.com/padosoft/agentic-qa-kit/security/advisories/new) — creates a private advisory only maintainers can see.

2. **Email:** `security@padosoft.com` with subject `[agentic-qa-kit] <short description>`.
   PGP key: published on the maintainers' Keybase / public key servers (link to be added when v0.1.0 ships).

## What to include

- Affected version(s)
- Reproduction steps (redact any real secrets)
- Potential impact (who is affected, what can be done)
- Suggested remediation (if you have one)

## What to expect

- Acknowledgement within 3 business days
- Initial assessment within 7 business days
- Public disclosure coordinated with you, normally after a patch ships
- Credit in the advisory (or anonymous if you prefer)

## Scope

In-scope:

- The kit, server, admin, schemas, official packs
- Official Helm chart, Terraform modules, Docker images
- Documentation that could mislead users into insecure config
- Default sandbox / cost / pack-signing posture

Out of scope (file as regular issues):

- Bugs that are not exploitable
- Vulnerabilities in user-supplied packs that are not in our official set
- Misconfiguration by the operator (e.g. running with sandbox disabled)
- Self-XSS in admin panel (we'll still fix, but not via security channel)

## Supply chain

- Pack signing (Sigstore) becomes mandatory in v0.3 (ADR-007). Until then, treat community packs as untrusted code.
- Dependencies scanned by Dependabot / Renovate plus `bun audit` or `npm audit`. Our minimum supported Bun version (`engines.bun` in `package.json`) is the floor; `bun audit` is available throughout that range.

## Compliance roadmap

See `docs/compliance/matrix.md` (v0.3+) for SOC2/ISO27001/GDPR/HIPAA/PCI alignment.
