import type { Adapter, RenderContext, RenderedFile } from './types.js';

const INSTRUCTIONS = (ctx: RenderContext) => `# GitHub Copilot instructions — \`${ctx.projectName}\`

> Read \`AGENTS.md\` first. This file adds Copilot-specific notes only.

## What Copilot should do here

- Suggest code that respects the \`.aqa/risk-map.yaml\` invariants. If a suggestion would break a
  documented invariant, propose the safe alternative instead.
- Before committing, mentally run \`bunx aqa validate\` and flag any required \`.aqa/*\` change.

## Hard rules

- Never bypass authentication / authorisation in suggestions.
- Never propose code that disables logging or audit emission.
- Never propose secrets / credentials inline.
`;

const SKILL_AQA_RUN = `---
name: aqa-run
description: Run the AQA loop before opening a PR. Use when the user mentions "ready for review", "open PR", "validate".
---

Run \`bunx aqa run --profile release-gate\` and surface findings.
`;

export const copilotAdapter: Adapter = {
  target: 'copilot',
  capabilities: {
    skills: true,
    subagents: false,
    hooks: true,
    instruction_file: '.github/copilot-instructions.md',
  },
  render(ctx: RenderContext): RenderedFile[] {
    return [
      { path: '.github/copilot-instructions.md', kind: 'instruction', contents: INSTRUCTIONS(ctx) },
      { path: '.github/skills/aqa-run.md', kind: 'skill', contents: SKILL_AQA_RUN },
    ];
  },
};
