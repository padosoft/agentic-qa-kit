# Admin panel placeholder audit (v1.7 slice 4)

> Internal planning doc. Tracks the user's v1.7 mandate: "implement every placeholder button + interaction in the admin panel". Updated `2026-05-18`.

## Scope

`packages/admin/src/app.tsx` contains the entire bundled admin (the v1.5 design-handoff port). Static analysis shows:

- **126 `<button>` elements** in total, of which:
  - **45 have an `onClick` handler** wired to a real action or local state (some calling toasts, some doing meaningful work, some still cosmetic)
  - **81 have NO `onClick` at all** — pure visual placeholders
- **91 *click targets* with `onClick` handlers across the whole file**, counting both the 45 wired `<button>`s above and ~46 non-button click targets (`<div onClick=…>`, `<span onClick=…>`, `<tr onClick=…>` for table rows, tabs, dropdowns, list rows). The non-button click targets also need triage — many should become real `<button>`s for accessibility before being wired or marked decorative.

In other words: 126 buttons (= 45 wired + 81 silent) and a separate ~46 non-button click targets, for a total of ~172 interactive elements to audit.

## Categorization

For each placeholder, decide ONE of:

- **W** — *wire to a real endpoint*. The action is functional (Save, Delete, Run, Install). Needs a `@aqa/server` route + an HTTP call from the admin. New TDD tests cover both.
- **C** — *implement client-side*. The action is presentational only (toggle a view, expand a row, open a modal). No backend, but the UI behavior must work.
- **D** — *explicit decorative*. The button only exists for visual completeness (a "View more" pattern, a stub for future work). Replace the bare `<button>` with `<button disabled title="Coming soon">` or a `<span>` so it doesn't claim to be clickable.

## Per-page placeholder inventory

The line numbers below were captured against commit `~v1.6.0` (post-merge of PR #24, pre-v1.7 audit start). They'll drift as the audit progresses; use them as starting hints, not authoritative references.

### Findings (lines ~3500-3970)

- `3521`, `3524` — verify / reject row actions
- `3609` — open detail
- ~~`3837`, `3840` — kanban card actions~~ **DONE (slice 4a, PR #27):** the kanban confirm-transition modal is now wired to `POST /api/findings/:id/status` with required reason input + error alert + disabled-until-reason submit. Drag-and-drop opens the modal (terminal columns) or POSTs directly with a default reason (non-terminal `draft` column); happy-path closes the modal and moves the card; 4xx/5xx keeps the modal open with the server's error message and leaves the card in its original column. 6 Playwright e2e tests cover the flow (4 terminal + 2 non-terminal). **Not yet wired:** the server-side hook that appends a `finding.status_changed` event to the audit chain — `MemoryStore.updateFindingStatus` today only mutates the finding record; the EventKind schema doesn't yet define `finding.status_changed`. Tracked as a v1.7.x follow-up.
- `3967`, `3970` — cluster expand

### Risks (lines ~4660-4730)

- `4665` — add invariant
- `4714`, `4726` — edit / delete risk row

### Scenarios (lines ~4980-5230)

- `4980`, `4984`, `4988` — scenario row actions (run/edit/clone)
- `5023`, `5027`, `5042`, `5046`, `5050` — oracle/probe inline edit
- `5159`, `5174`, `5177`, `5181`, `5184`, `5215`, `5220`, `5225`, `5229` — step builder controls

### Profiles (lines ~5500-5950)

- `5590`, `5745`, `5796` — profile-level actions (save/clone/delete)
- `5927`, `5931`, `5935`, `5939` — pack picker

### Agents (lines ~6500-6630)

- `6537`, `6623` — install instructions copy / "Install for X" buttons

### Packs (lines ~6850-7040)

- ~~`6850`, `6853` — top-bar "Import manifest" / "Install pack" (slice 3 wires "Install pack" via the new wizard)~~ **DONE (slice 3, PR #26):** the "Install pack" placeholder was renamed to "Create pack" and wired to the new `<CreatePackWizard>` component that POSTs to `/api/packs/scaffold`. "Import manifest" remains a placeholder for slice 4b.
- `6910`, `6914`, `6925` — pack row actions (toggle / inspect)
- `6986` — pack detail actions
- `7028`, `7033`, `7038` — scenario picker inside pack detail

### Replay / Audit / Cost / Queue / Notifications (lines ~7280-7640)

- `7287`, `7417`, `7421`, `7565`, `7638` — various export / filter / mark-read buttons

### Admin (Users / Roles / SSO / Org / Tokens / Admin Audit)

Not yet line-counted — comes after the first 49 fit.

## Sequencing

Doing all 81 in one PR is unreviewable. Plan: **one PR per page** so each is a manageable review surface.

1. ~~**slice 4a — Findings page actions** (verify, reject, mark-fixed, mark-duplicate row actions). Needs `PATCH /api/findings/:id/status` (already exists in `packages/server` from v1.4). Just wire the UI buttons.~~ **SHIPPED (PR #27).** Kanban terminal-transition modal wired to `POST /api/findings/:id/status`. Drag-and-drop, required-reason capture, error-on-fail, optimistic UI only after server confirmation. The server *persists* the new status to the store; appending a corresponding `finding.status_changed` event to the audit chain is a separate task tracked as a v1.7.x follow-up (requires extending the `EventKind` enum in `@aqa/schemas` and the store's `updateFindingStatus` to append the event). Remaining row actions in clusters/list views (verify/reject inline buttons) also deferred to a follow-up PR — today the kanban is the canonical status-change surface.
2. **slice 4b — Packs page** (Import manifest, Install pack). "Install pack" delegates to the wizard from slice 3; "Import manifest" needs a `POST /api/packs/import` route.
3. **slice 4c — Scenarios / Risks / Profiles CRUD** (edit/save/clone/delete). Heaviest slice — needs full CRUD flows on three resources.
4. **slice 4d — Agents page** (install-instructions copy, "Install for X"). Mostly client-side (copy to clipboard, download files).
5. **slice 4e — Replay / Audit / Cost / Queue / Notifications** (export CSV, mark-read, drain, pause). Mix of W + C.
6. **slice 4f — Admin section** (Users / Roles / SSO / Org / Tokens / Admin Audit). Each is its own CRUD surface.

Each slice gets:
- TDD: failing Playwright e2e per button BEFORE wiring
- A `@aqa/server` route if W
- A `packages/admin/src/app.tsx` edit
- One commit per button category to keep diffs reviewable

## Acceptance criteria for "v1.7 slice 4 complete"

- Every `<button>` in `packages/admin/src/app.tsx` either:
  - has an `onClick` that does meaningful work (W or C), **or**
  - has `disabled` + a `title` explaining why (D, with a comment pointing at the v1.7.x follow-up issue that will wire it)
- Every `<div onClick=…>` / `<span onClick=…>` style click-target gets the same triage
- The set of W buttons all have matching Playwright tests asserting the click triggers the documented behavior
- `docs/internal/admin-placeholder-audit.md` (this file) is updated with the final disposition of each line
