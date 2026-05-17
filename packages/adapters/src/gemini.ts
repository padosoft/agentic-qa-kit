import type { Adapter, RenderContext, RenderedFile } from './types.js';

const INSTRUCTIONS = (ctx: RenderContext) => `# Gemini CLI instructions for \`${ctx.projectName}\`

> Read \`AGENTS.md\` first. This file adds Gemini-specific notes only.

## Skill activation

The Gemini CLI auto-discovers skills under \`.gemini/skills/*.md\`. Activate them via the
\`activate_skill\` tool. Run \`aqa-run\` before opening a PR.

## Permission profile

- Read freely inside this repository.
- Write only inside this repository.
- Bash: \`git\`, \`gh\`, \`bun\`, \`bunx\`, \`npm\`, \`npx\`, \`node\`, \`playwright\`.
`;

const SKILL_AQA_RUN = `---
name: aqa-run
description: Run the agentic QA loop via \`bunx aqa run\`. Use when the user asks to "run AQA", "validate", "find regressions".
---

Invoke \`bunx aqa run --profile <name>\` and report every finding in
\`.aqa/runs/<id>/findings.jsonl\`. Sort by severity. Stop at the first critical unless the user
wants a full sweep.
`;

export const geminiAdapter: Adapter = {
  target: 'gemini',
  capabilities: { skills: true, subagents: true, hooks: false, instruction_file: 'GEMINI.md' },
  render(ctx: RenderContext): RenderedFile[] {
    return [
      { path: 'GEMINI.md', kind: 'instruction', contents: INSTRUCTIONS(ctx) },
      { path: '.gemini/skills/aqa-run.md', kind: 'skill', contents: SKILL_AQA_RUN },
    ];
  },
};
