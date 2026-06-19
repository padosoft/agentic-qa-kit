---
title: Reports and Replay
description: Interpret findings and reproduce verified failures.
---

# Reports and Replay

Each run writes evidence under `.aqa/runs/RUN_ID/`. Reports summarize the same facts in Markdown and JSON.

## Artifacts

- `events.jsonl`: hash-chained run events.
- `findings.jsonl`: normalized findings.
- `report.md`: human review report.
- `report.json`: machine-readable report.
- `repro.sh`, `repro.curl`, `repro.playwright.ts`: replay evidence when available.

::: callout info "Three-level replay" icon:repeat
The replay contract distinguishes bug-level deterministic replay, scenario-level repeatability, and agent-level narrative reproduction.
:::

## Triage loop

::: steps
1. **Confirm severity**
   Compare the finding against the declared invariant, not just the generated prose.
2. **Run replay**
   Execute the smallest replay artifact that proves the bug.
3. **Patch and test**
   Add a regression test close to the owning code.
4. **Verify fix**
   Re-run the relevant profile and attach the new report to the change.
:::
