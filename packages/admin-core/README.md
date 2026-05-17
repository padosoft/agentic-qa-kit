# @aqa/admin-core

Headless editing primitives the admin panel (`@aqa/admin`) consumes for
write-back flows (Scenario Studio, Risk Editor — Task 17).

- `OptimisticEditor<T>` — base / pending / committed / effective state with
  `propose` / `commit` / `rollback`.
- `detectConflict(client, server)` — ETag-like detection of concurrent edits;
  returns categorised reason (`no-change` / `identical` / `conflict`).

The admin panel's React stores use these classes verbatim — no UI coupling.
