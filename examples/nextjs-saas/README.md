# `examples/nextjs-saas`

Minimal Next.js 15 app showing `agentic-qa-kit` against a web + API target.

## What's interesting

- Wires `pack-web-ui` (Playwright probes) + `pack-api-core` (HTTP probes).
- Declares a session-cookie invariant (`HttpOnly + SameSite=Lax + Secure`)
  in the `risks:` block — the runner asserts it via the security pack.

## Run

```bash
npm install   # or bun install
npm run dev   # :3000
aqa run --profile release-gate
```
