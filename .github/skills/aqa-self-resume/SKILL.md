---
name: aqa-self-resume
description: Use ALWAYS at the start of a fresh session on agentic-qa-kit, or after any non-trivial interruption. Loads context from PROGRESS.md, LESSON.md, git, and gh, so the next action picks up exactly where the previous session stopped. Triggers on "where were we", "what was I doing", "resume", "continue from last session", or any first message of a new session involving this repo.
---

# AQA self-resume

When you start fresh on `agentic-qa-kit` (new session, new sub-agent, or after an interruption), run this protocol **before** any action.

## Step 1 — Read the governance files

```text
AGENTS.md                                        (operating rules — full read)
docs/PROGRESS.md                                  (last 100 lines)
docs/LESSON.md                                    (last 100 lines)
docs/RULES.md                                     (skim if not in context)
```

## Step 2 — Inspect git state

```bash
git status
git log --oneline -10
git branch --show-current
git diff --stat HEAD
```

If on `main`, the current macro task may not have started; check `docs/PROGRESS.md` next-step pointer.

## Step 3 — Inspect PR state

```bash
gh pr list --state open --json number,title,headRefName,baseRefName,statusCheckRollup,reviews
gh pr status
```

Identify any PR awaiting Copilot feedback or CI green.

## Step 4 — Identify the resume point

From `docs/PROGRESS.md` last entry, the resume action is one of:

- **A sub-task in progress** with code partially written → continue implementation.
- **A PR open waiting for CI/Copilot** → run step 5 of `aqa-process-loop` skill (wait + poll).
- **A PR open with comments to fix** → run step 7 of `aqa-process-loop` skill.
- **A sub-task completed but PR not opened** → run steps 2-4 of `aqa-process-loop` skill.
- **A sub-task fully closed** → pick next sub-task from the macro task spec in the plan.

## Step 5 — Confirm understanding before action

Before writing code or running destructive commands, summarize to the user in 2-3 lines:

- "We are in macro task X, sub-task Y."
- "Last action was Z."
- "Next action will be W."

Wait for confirmation if the next action is non-trivial (creating a PR, merging, tagging a release).

## Step 6 — Honor the operating rules

All hard rules from `AGENTS.md` apply (no force-push to main, no skipped gates, Copilot review on every PR, update LESSON.md after Copilot iterations).
