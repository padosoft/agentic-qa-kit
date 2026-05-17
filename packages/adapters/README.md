# @aqa/adapters

Render per-agent instruction files and skill manifests for `agentic-qa-kit`'s four tier-1 hosts:
**Claude**, **Codex**, **Gemini**, **GitHub Copilot**.

```ts
import { renderForTargets } from '@aqa/adapters';
import { writeFileSafe } from '@aqa/kit';

const { all } = renderForTargets(['claude', 'copilot'], { projectName: 'demo', root: process.cwd() });
for (const f of all) {
  writeFileSafe(`${process.cwd()}/${f.path}`, f.contents);
}
```

## Capability matrix

| Target  | Instruction file                     | Skills | Sub-agents | Hooks |
|---------|--------------------------------------|--------|------------|-------|
| Claude  | `CLAUDE.md`                          | ✓      | ✓          | ✓     |
| Codex   | `AGENTS.md`                          | ✓      | —          | —     |
| Gemini  | `GEMINI.md`                          | ✓      | ✓          | —     |
| Copilot | `.github/copilot-instructions.md`    | ✓      | —          | ✓     |

The capability flags drive `aqa install-agent-files` so missing-feature dependencies (e.g. asking
Codex for sub-agent dispatch) surface as an explicit error rather than silently working.
