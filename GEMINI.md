# Gemini CLI instructions for `agentic-qa-kit`

> **Read `AGENTS.md` first.** It is the canonical source of operating rules. This file adds Gemini-specific notes only.

## Gemini-specific guidance

- Skills are activated via `activate_skill`. Skills in `.gemini/skills/aqa-*` mirror Claude's. Use them for the AQA workflow.
- Custom subagents live in `.gemini/agents/aqa-*.md` with Markdown + YAML frontmatter.
- Custom slash commands live in `.gemini/commands/aqa/*.toml`.
- When both `GEMINI.md` and `AGENTS.md` exist at the same path, `GEMINI.md` takes precedence. This file delegates to `AGENTS.md` to keep behavior identical across agents.

## Permission profile

Same as Claude — read freely, write only inside this repo, no destructive git/gh operations without user approval.

## Self-resume

Same protocol as `AGENTS.md § Self-resume protocol`.
