# `examples/` — agentic-qa-kit example projects

Each subdirectory is a **runnable target** for `aqa run`. The point isn't
the app itself — it's to show how a real project wires up `aqa init`,
profiles, and pack selection for a given stack.

## What's here

- [`bun-api/`](./bun-api) — Hono + Bun API, profile `api-core` + `security`.
- [`nextjs-saas/`](./nextjs-saas) — Next.js 15 app, profile `web-ui` +
  `api-core`, demonstrates auth + session invariants.
- [`laravel-app/`](./laravel-app) — Laravel 11 PHP app, profile `api-core`.
  Shows that AQA is target-language agnostic — probes are HTTP, oracles
  are declarative, the runner doesn't care what served the request.

## Try one

```bash
cd examples/bun-api
bun install
bun run dev &
aqa run --profile security
```

`aqa` reads `agentic-qa-kit.yaml` in the project root; each example ships
a minimal one.
