# @aqa/reporter

Reporters and replay artifact generators.

```ts
import { renderMarkdown, renderJson, buildReplayArtifacts } from '@aqa/reporter';

const md = renderMarkdown({ run, findings });
const json = renderJson({ run, findings });
for (const a of buildReplayArtifacts({ finding, scenario })) {
  writeFileSync(join(run.artifact_dir, a.path), a.contents);
}
```

- `renderMarkdown(input)` → severity-sorted Markdown report with run header + per-finding section.
- `renderJson(input)` → stable JSON shape (`schema_version: '1'`) consumed by the admin UI.
- `buildReplayArtifacts(input)` → `repro.sh` / `repro.curl` for HTTP probes, `repro.playwright.ts`
  for Playwright probes, `repro.sql` placeholder for SQL probes. SARIF + HTML reporter land in v0.1.1.
