# Claude Code instructions for `agentic-qa-kit`

> **Read `AGENTS.md` first.** It is the canonical source of operating rules, branch strategy, validation loop, and Definition of Done for this repository. This file adds Claude-specific notes only.

## Claude-specific guidance

- Use the `Skill` tool to invoke any `.claude/skills/aqa-*` skill. List in `.claude/skills/README.md`.
- Use sub-agents (`Task` tool with `subagent_type`) for parallel work when sub-tasks are independent. Always pass the handoff context defined in `AGENTS.md § Sub-agent context handoff`.
- Use `TaskCreate` / `TaskUpdate` / `TaskList` to track macro tasks and sub-tasks. The current task list mirrors the macro tasks in the durable plan.
- Prefer `Explore` sub-agent for cross-codebase searches, `Plan` sub-agent for design checks, dedicated specialists where available.
- Use plan mode for any non-trivial change (≥ 3 files or new concept).

## Permission profile

Stay within these defaults unless the user explicitly approves an exception:

- **Read** freely within this repository.
- **Write only** inside this repository. Never write outside.
- **Bash:** allowed for `git`, `gh`, `bun`, `bunx`, `npm`, `npx`, `node`, `playwright`. **Forbid** without user approval: anything destructive on shared state (`git push --force`, `git reset --hard` on `main`, `gh release delete`, `rm -rf` outside `.aqa/tmp/`).
- **GitHub:** can push branches, open PRs, comment, request reviewers, merge with `--squash --delete-branch`. **Cannot** delete branches manually outside the merge flow, cannot delete releases, cannot push to `main` directly.

## Self-resume in a fresh Claude session

If you are starting fresh on this repo:

1. `Read AGENTS.md` (repo root)
2. `Read docs/PROGRESS.md` (last 100 lines)
3. `Read docs/LESSON.md` (last 100 lines)
4. `Bash git status && git log --oneline -10`
5. `Bash gh pr list --state open --json number,title,headRefName`
6. Use `TaskList` to see macro task tracking
7. Resume from the in-progress sub-task

## Memory & long context

This repository is long-lived. When running under Claude Code, use the auto-memory system in your local Claude project memory directory (path is environment-specific; see the Claude Code docs) to persist:

- User preferences specific to this project
- Feedback patterns ("user prefers terse PR descriptions", etc.)
- Project facts (current macro task, blockers)
- References (external systems used)

Do **not** persist things derivable from code or git history; those belong in `docs/LESSON.md` instead. Do **not** commit references to local maintainer paths into this repository.
