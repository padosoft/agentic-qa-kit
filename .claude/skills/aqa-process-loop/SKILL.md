---
name: aqa-process-loop
description: Hard process loop for working on agentic-qa-kit. Use ALWAYS when opening any sub-task, sub-task PR, macro-task PR, or when triggered by request to "follow the process", "request Copilot review", "run the loop", "open PR for this task". Encodes branch strategy, validation gates, Copilot review request (with GraphQL fallback), and merge rules from AGENTS.md.
---

# AQA process loop

You are working on `agentic-qa-kit`. Apply this loop verbatim for every sub-task and PR. Reference: `AGENTS.md § Branch and PR loop`.

## Step 1 — Branch hygiene

- Confirm current branch matches the convention: `task/<macro-slug>/<sub-slug>` for sub-tasks, `task/<macro-slug>` for macro work.
- Sub-task branches start from the macro branch HEAD, **not** from `main`.
- If you are unsure, do not push. Read `docs/PROGRESS.md` first.

## Step 2 — Local gates (ALL must pass)

```bash
bun install
bun run typecheck
bun run lint
bun test
bun run build
# If UI touched:
bunx playwright test --reporter=line
```

If any gate is red, fix locally before pushing. Never push red commits.

## Step 3 — Open PR

```bash
gh pr create \
  --base <target-branch> \
  --title "<conventional-commit-style title>" \
  --body "$(cat <<'EOF'
## Goal
<one sentence>

## What changed
- ...

## DoD checklist
- [x] Local gates green
- [ ] Copilot review requested
- [ ] CI green
- [ ] Comments resolved
EOF
)"
```

Use the PR template; it will pre-fill the structure.

## Step 4 — Request Copilot Code Review

Fast path:

```bash
gh pr edit <pr-num> --add-reviewer copilot-pull-request-reviewer
```

If that fails because the token lacks `read:project` scope, GraphQL fallback:

```bash
PR_NODE=$(gh pr view <pr-num> --json id -q .id)
gh api graphql -f query='
mutation RequestReviewsByLogin($pullRequestId: ID!, $botLogins: [String!], $union: Boolean!) {
  requestReviewsByLogin(input: {pullRequestId: $pullRequestId, botLogins: $botLogins, union: $union}) {
    clientMutationId
  }
}
' -F pullRequestId="$PR_NODE" -F botLogins[]='copilot-pull-request-reviewer[bot]' -F union=true
```

Verify:

```bash
gh api repos/<owner>/<repo>/pulls/<pr-num>/requested_reviewers
```

If both API paths leave `reviewRequests` empty: log the blocker in `docs/PROGRESS.md`, request Copilot manually from the PR sidebar Reviewers menu, do **not** substitute another reviewer.

## Step 5 — Wait & poll

Do not move on. Poll CI and review state:

```bash
gh pr view <pr-num> --json statusCheckRollup,reviews,comments,mergeable
gh pr checks <pr-num>
```

## Step 6 — If green & no blockers → merge

```bash
gh pr merge <pr-num> --squash --delete-branch
```

## Step 7 — If red or comments

1. Fix locally.
2. Re-run all local gates (step 2).
3. `git push` (creates a new commit on the same branch).
4. Re-request Copilot review (step 4).
5. Return to step 5.

## Step 8 — Post-merge bookkeeping

- Pull latest macro / main branch locally.
- Update `docs/PROGRESS.md` (sub-task done, next sub-task).
- Update `docs/LESSON.md` if Copilot review surfaced something worth remembering.
- If macro task complete: open macro PR → `main`, run this loop again.

## Rules

- **Never** merge without Copilot review (or documented blocker).
- **Never** force-push to `main`.
- **Never** skip gates to "save time".
- **Always** resolve every Copilot comment or explicitly reject with motivation.
- **Always** update `docs/LESSON.md` after Copilot iterations.

If a step blocks (CI broken on shared infra, GitHub outage, Copilot unavailable): record in `docs/PROGRESS.md`, surface to the user, do not invent a workaround.
