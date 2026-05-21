# `@aqa/pack-author`

Pack scaffolding primitives — shared between `@aqa/kit` (CLI) and `@aqa/server` (API).

## Why this package exists

Both the CLI (`aqa pack new <slug>`) and the server (`POST /api/packs/scaffold`) need to scaffold runnable AQA packs on disk. Originally the logic lived inside `@aqa/kit` and `@aqa/server` imported it from there. When the v1.9 `aqa admin` command needed `@aqa/kit` to depend on `@aqa/server` (for `makeApi()`), the cycle made the topological build non-deterministic and the kit's TypeScript compile started failing in CI.

This package breaks the cycle by owning the scaffolding logic. Both kit and server depend on `@aqa/pack-author`; neither depends on the other.

## API surface

```ts
import { runPackNew } from '@aqa/pack-author';
import type { PackNewOptions, PackNewResult, PackNewErrorCode } from '@aqa/pack-author';
```

- `runPackNew(opts: PackNewOptions): PackNewResult` — synchronous; creates `<root>/packs/<slug>/` with a schema-valid `pack.yaml`, one starter scenario, one starter risk, README, and package.json. Atomic-ish `--force`: a failed scaffold restores the original pack from a backup directory.
- `PackNewErrorCode = 'EEXIST' | 'EINVAL' | 'EIO'` — stable error codes that callers can map to HTTP status / CLI exit codes without regex-matching the human-readable message.

## Tests

Heavy behaviour coverage lives in `packages/kit/test/pack-new.test.ts` (which calls through the kit's 5-line re-export shim). This package's own `test/pack-author.test.ts` is a package-boundary smoke — verifies the named export shape and the structured-error contract.
