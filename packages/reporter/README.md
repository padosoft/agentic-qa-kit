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
- `buildReplayArtifacts(input)` → `repro.sh` / `repro.curl` for HTTP probes,
  executable structured-action `repro.playwright.ts`, and read-only prepared
  `repro.sql` for SQL probes. External script-only browser probes are marked
  explicitly as requiring the original spec; they are never presented as
  deterministic replay.
- `buildMinimizedCounterexampleReplay(input)` → bounded JSON shrinking through
  a caller-owned failure predicate, a redacted `counterexample.min.json`, and
  the evidence path to attach to the finding. It never executes the SUT.
