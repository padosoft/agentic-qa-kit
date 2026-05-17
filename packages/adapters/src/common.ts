import type { RenderContext } from './types.js';

const AGENTS_MD_BODY = (ctx: RenderContext) => `# AGENTS.md — ${ctx.projectName}

> Canonical operating rules for any AI agent (Claude, Codex, Gemini, Copilot) working on this
> repository. This file is the source of truth; per-agent adapters delegate to it.

## Working with this project

This repository ships an \`agentic-qa-kit\` (\`.aqa/\`) configuration. The kit operates the QA loop
around the SUT and the agent is one of multiple actors that contribute to it (read \`docs/RULES.md\`
in the kit repo for the dual-mode \`execution_mode\` semantics).

## Hard rules

1. **Read \`.aqa/project.yaml\` and \`.aqa/risk-map.yaml\` before any task** that touches the SUT.
2. **Validate** any change via \`bunx aqa validate\`. Refuse to ship if validation fails.
3. **Never** delete \`.aqa/runs/*\` artifacts; they are immutable audit evidence.
4. **Per Definition of Done**, every PR runs \`bunx aqa run --profile release-gate\` and resolves
   every finding (verified / rejected with motivation / duplicate).

## How this file relates to per-agent files

\`AGENTS.md\` is canonical. The per-agent files (\`CLAUDE.md\`, \`GEMINI.md\`,
\`.github/copilot-instructions.md\`) are thin delegators that add only what is agent-specific
(skill activation, sub-agent dispatch, hook routing). When in doubt, behave as \`AGENTS.md\` says.
`;

export function renderAgentsMd(ctx: RenderContext): string {
  return AGENTS_MD_BODY(ctx);
}
