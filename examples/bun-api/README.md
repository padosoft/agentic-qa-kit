# `examples/bun-api`

Minimal Hono + Bun API showing `agentic-qa-kit` against a JSON HTTP target.

## Run

```bash
bun install
bun run dev   # listens on :3000
```

## QA

```bash
aqa run --profile api-core
aqa run --profile security
```

The `agentic-qa-kit.yaml` wires this project to `pack-core`, `pack-api-core`,
and `pack-security`. The runner discovers `/items/:id` validators and
exercises the deterministic-replay invariants.
