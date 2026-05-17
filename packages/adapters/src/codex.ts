import { renderAgentsMd } from './common.js';
import type { Adapter, RenderContext, RenderedFile } from './types.js';

const SKILL_AQA_RUN = `---
name: aqa-run
description: Use when the user asks to run AQA against the SUT, validate before merge, or chase a regression.
---

Run \`bunx aqa run --profile <name>\` from the repo root and surface every finding from
\`.aqa/runs/<id>/findings.jsonl\` — severity, title, suggested fix. Stop at the first critical
unless the user asked for a full sweep.
`;

export const codexAdapter: Adapter = {
  target: 'codex',
  capabilities: { skills: true, subagents: false, hooks: false, instruction_file: 'AGENTS.md' },
  render(ctx: RenderContext): RenderedFile[] {
    return [
      { path: 'AGENTS.md', kind: 'instruction', contents: renderAgentsMd(ctx) },
      { path: '.agents/skills/aqa-run.md', kind: 'skill', contents: SKILL_AQA_RUN },
    ];
  },
};
