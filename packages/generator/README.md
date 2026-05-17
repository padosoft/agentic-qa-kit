# @aqa/generator

LLM-assisted scenario generator with a human-in-the-loop review queue.

- `proposeScenarios({ risk_id, invariant_statement, llm, queue, model })`
  asks the LLM for draft scenarios; only drafts that validate against
  `Scenario` enter the queue.
- `ReviewQueue` holds drafts in `pending`; `approve(id, reviewer)` /
  `reject(id, reviewer, rationale)` are the only ways out. Approved
  scenarios are returned by `approvedScenarios()` and pulled into the
  active profile by the runner.

Nothing flows into the active profile without explicit approval.
