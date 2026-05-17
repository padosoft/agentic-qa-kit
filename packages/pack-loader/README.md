# @aqa/pack-loader

Discovery + validation for `agentic-qa-kit` packs.

```ts
import { loadPacks, appliesWhen } from '@aqa/pack-loader';

const packs = loadPacks('./packs');                       // every pack under ./packs/*/pack.yaml
const installed = packs.filter((p) => appliesWhen(p.manifest, {
  runtime: 'bun', framework: 'hono', db: ['postgres'], sut_type: 'api', tags: ['ci'],
}));
```

Manifest schema lives in `@aqa/schemas` (`PackManifest`). Manifest filenames: `pack.yaml` (preferred)
or `pack.yml`.

`applies_when` semantics: every clause AND-together; a missing clause is "any". See
`src/applies-when.ts` for the canonical rules.
