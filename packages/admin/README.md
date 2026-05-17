# @aqa/admin

Admin panel scaffold for `agentic-qa-kit`. At v0.1.0 the package is a **read-only viewer** over
`.aqa/runs/*`; editing flows land in Task 17 (`task/admin-editing`).

## What's here

- **Vite + React 19 + TS strict** scaffold.
- A minimal sidebar shell (`src/App.tsx`) with 12 routes from `src/router.ts` — Dashboard, Runs,
  Findings, Risk map, Profiles, Packs, Scenarios, Agents, Replay, Audit log, Cost, Settings.
- Each route renders a typed `ScreenPlaceholder` documenting what lands when. The full
  25-screen spec is in `docs/design/admin-panel-template.md`.

## Development

```bash
bun install
bun run --filter @aqa/admin dev      # vite dev server on http://127.0.0.1:5173
bun run --filter @aqa/admin build    # static build to dist/
bun run --filter @aqa/admin test     # router unit tests (node:test)
```

## Out of scope at v0.1.0

- Tailwind 4 setup, TanStack Router wiring (currently a flat string-keyed router stub).
- Real data — the placeholder screens explain what each route will show once the local-files API
  + per-screen components land.
- Playwright e2e for screen rendering (the repo-wide e2e job is wired but admin tests are placeholders).

This package ships as `private: true` and is not published to npm at v0.1.0.
