import type { Adapter, RenderContext, RenderedFile } from './types.js';

const INSTRUCTIONS = (ctx: RenderContext) => `# Claude Code instructions for \`${ctx.projectName}\`

> Read \`AGENTS.md\` first. This file adds Claude-specific notes only.

## Claude-specific guidance

- Use the \`Skill\` tool to invoke any \`.claude/skills/aqa-*\` skill.
- Use sub-agents (\`Task\` tool with \`subagent_type\`) for parallel work; pass the handoff
  context defined in \`AGENTS.md\`.
- Prefer the \`Explore\` sub-agent for cross-codebase searches and \`Plan\` for design checks.

## Permission profile

- **Read** freely inside this repository.
- **Write only** inside this repository.
- **Bash:** \`git\`, \`gh\`, \`bun\`, \`bunx\`, \`npm\`, \`npx\`, \`node\`, \`playwright\`.
- Never push to \`main\` directly.
`;

const SKILL_AQA_RUN = `---
name: aqa-run
description: Run \`bunx aqa run --profile <name>\` and surface every finding back to the user. Use when the user asks to "run AQA", "test for regressions", "validate before merge".
---

When invoked:
1. Confirm the profile (default \`smoke\` for inner-loop, \`release-gate\` for merge gate).
2. Run \`bunx aqa run --profile <profile>\` from the repo root.
3. For each finding in \`.aqa/runs/<id>/findings.jsonl\`, summarise (severity, title, suggested fix).
4. Stop at the first \`critical\` finding unless the user asked for a full sweep.
`;

const SKILL_AQA_VALIDATE = `---
name: aqa-validate
description: Run \`bunx aqa validate\` to schema-check \`.aqa/*\`. Use before opening a PR or after edits to risk-map / profiles.
---

\`bunx aqa validate\` parses \`.aqa/project.yaml\`, \`.aqa/risk-map.yaml\`, \`.aqa/profiles.yaml\` and
validates each against \`@aqa/schemas\`. Surface every error path verbatim; do not paraphrase.
`;

export const claudeAdapter: Adapter = {
  target: 'claude',
  capabilities: { skills: true, subagents: true, hooks: true, instruction_file: 'CLAUDE.md' },
  render(ctx: RenderContext): RenderedFile[] {
    return [
      { path: 'CLAUDE.md', kind: 'instruction', contents: INSTRUCTIONS(ctx) },
      { path: '.claude/skills/aqa-run.md', kind: 'skill', contents: SKILL_AQA_RUN },
      { path: '.claude/skills/aqa-validate.md', kind: 'skill', contents: SKILL_AQA_VALIDATE },
    ];
  },
};
