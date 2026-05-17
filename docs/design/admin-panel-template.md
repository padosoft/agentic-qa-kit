# Admin panel template — design specification

> **Audience:** UI designer or frontend developer building the visual template for `agentic-qa-kit-admin` in parallel with backend work. This spec is detailed enough that you can ship a static template (Vite + React + Tailwind) without backend integration; data wiring happens in Task 7.
>
> **Scope:** the complete admin SPA. Tech stack, design tokens, layout grid, components, 25 screens with wireframes and interaction notes, dark mode, accessibility, Playwright scenarios to plan upfront.

## 1. Tech stack (vincolato — non negoziare)

| Layer | Choice | Version | Notes |
|---|---|---|---|
| Framework | React | 19 | Server components NOT used; SPA only |
| Build | Vite | 6 | `vite.config.ts` with `@vitejs/plugin-react` |
| Language | TypeScript | 5.6+ | strict + `noUncheckedIndexedAccess` |
| Styling | Tailwind CSS | 4 | No preprocessor; CSS variables for theme |
| Component primitives | shadcn/ui | latest | Radix-based, copied into `src/components/ui/` |
| Icons | Lucide React | latest | Inline SVG for custom |
| Server state | TanStack Query | v5 | Optimistic updates allowed |
| Client state | Zustand | latest | Per-slice stores; React Context only for narrow trees |
| Routing | TanStack Router | latest | Typed routes; file-based router |
| Forms | React Hook Form | latest | + Zod resolver |
| Charts | Recharts | latest | + visx only for the live timeline |
| Tables | TanStack Table | v8 | Virtualization where >100 rows |
| Date | date-fns | latest | No moment.js |
| Editor | Monaco | latest | YAML + JSON + Markdown |
| Test unit | Vitest | latest | + Testing Library |
| Test e2e | Playwright | latest | Chromium baseline |
| Lint/format | Biome | 1.9+ | Single root config |

## 2. Design tokens (Tailwind 4 theme)

Tailwind v4 dark variants are declared via `@custom-variant`; theme values live in a single `@theme` block, and the dark-mode override uses a `.dark`-scoped CSS variable declaration (consumed by the variant). This is the correct v4 syntax — a separate `@theme dark { ... }` block does not exist.

```css
/* In your main CSS file (e.g. src/styles/global.css) */
@import "tailwindcss";

/* Dark mode: enable the .dark class anywhere in the tree to activate dark variants */
@custom-variant dark (&:where(.dark, .dark *));

@theme {
  /* Color — neutrals (light defaults) */
  --color-bg-base: #f8fafc;          /* slate-50 */
  --color-bg-elevated: #ffffff;
  --color-bg-overlay: rgba(15, 23, 42, 0.4);
  --color-fg-base: #0f172a;          /* slate-900 */
  --color-fg-muted: #475569;         /* slate-600 */
  --color-fg-subtle: #94a3b8;        /* slate-400 */
  --color-border: #e2e8f0;           /* slate-200 */
  --color-border-strong: #cbd5e1;    /* slate-300 */

  /* Color — status accents (semantic) */
  --color-status-success: #10b981;   /* emerald-500 */
  --color-status-warning: #f59e0b;   /* amber-500 */
  --color-status-danger: #f43f5e;    /* rose-500 */
  --color-status-info: #0ea5e9;      /* sky-500 */
  --color-status-ai: #8b5cf6;        /* violet-500 — ALWAYS for AI-generated content */

  /* Severity (findings) */
  --color-sev-p0: #b91c1c;
  --color-sev-p1: #ea580c;
  --color-sev-p2: #ca8a04;
  --color-sev-p3: #65a30d;

  /* Type scale */
  --font-sans: "Inter", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;

  /* Radius (max 8px per RULES.md) */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;

  /* Density */
  --table-row-height: 36px;
  --topbar-height: 48px;
  --sidebar-width: 240px;
  --sidebar-width-collapsed: 56px;
}

/* Dark mode overrides (consumed by the .dark variant declared above) */
.dark {
  --color-bg-base: #020617;          /* slate-950 */
  --color-bg-elevated: #0f172a;      /* slate-900 */
  --color-fg-base: #f1f5f9;
  --color-fg-muted: #94a3b8;
  --color-fg-subtle: #64748b;
  --color-border: #1e293b;
  --color-border-strong: #334155;
  /* Status accents are kept identical across modes (semantic), tune only if WCAG fails. */
}
```

Toggle by adding/removing the `dark` class on `<html>`. Use `localStorage` (`theme: "light" | "dark" | "system"`) + `prefers-color-scheme` media query for initial mode.

## 3. Layout grid

```
┌─────────────────────────────────────────────────────────────┐
│ TopBar (h-12)                                               │
├──────┬──────────────────────────────────────────────────────┤
│Side  │                                                      │
│Nav   │  Main (overflow-y-auto)                              │
│(w-60 │  ┌─ Breadcrumb ──────────────────────────────────┐   │
│ /    │  │ Org / Project / Section / Detail              │   │
│ w-14 │  └────────────────────────────────────────────────┘  │
│ collapsed)│ ┌─ PageHeader: title + subtitle + actions ──┐   │
│      │  └────────────────────────────────────────────────┘  │
│      │  ┌─ PageBody (tabs / table / form / split) ──────┐   │
│      │  └────────────────────────────────────────────────┘  │
│      │                                                      │
└──────┴──────────────────────────────────────────────────────┘
```

- TopBar: logo (24px) · org switcher · project switcher · global search (⌘K) · notifications (with badge) · user menu.
- SideNav: collapsible (persisted), icon + label, active item has left accent border 2px (`--color-status-info`).
- Breadcrumb: `Org / Project / Section / [Detail]`, items navigable.
- PageHeader: `h1` title (text-lg semibold), subtitle (text-sm muted), primary actions right-aligned.

## 4. Screen inventory (25)

| # | Screen | Path | Notes |
|---|---|---|---|
| 1 | Login | `/login` | Email + password, SSO buttons (Google/GitHub/SAML/OIDC), forgot link |
| 2 | Org switcher | `/orgs` | Card list with role badge |
| 3 | Project list | `/orgs/:org/projects` | Table + create + filters |
| 4 | **Dashboard** | `/p/:proj/dashboard` | KPIs, last run, top findings, release gate, runners, cost |
| 5 | Runs list | `/p/:proj/runs` | Table: id, profile, status, duration, findings, cost, started |
| 6 | Run detail | `/p/:proj/runs/:runId` | Tabs: Overview · Timeline · Scenarios · Findings · Artifacts · Logs |
| 7 | Live Timeline | `/p/:proj/runs/:runId/timeline` | SSE stream, virtual scroll, filter by type/actor |
| 8 | Findings Kanban | `/p/:proj/findings` | Columns: New, Needs Verification, Verified, Rejected, Needs Regression, Closed |
| 9 | Finding detail | `/p/:proj/findings/:id` | Tabs: Evidence · Replay · Suggested Regression · History |
| 10 | Risk Map viewer | `/p/:proj/risk-map` | Table with coverage score and status pill |
| 11 | Risk Map editor | `/p/:proj/risk-map/edit` | Form + nested arrays + side-by-side diff before save |
| 12 | Scenario list | `/p/:proj/scenarios` | Table grouped by pack, run-single button |
| 13 | Scenario Studio | `/p/:proj/scenarios/:id` | Monaco YAML, live schema validation, AI button, run once |
| 14 | Packs | `/p/:proj/packs` | Card grid, enable/disable, version, signing status |
| 15 | Agents & Skills | `/p/:proj/agents` | Tabs per target adapter, install status, file paths |
| 16 | Prompt Lab | `/p/:proj/prompts/:id` | Editor split (current + draft), test box, diff, save as version |
| 17 | Release Gate | `/p/:proj/release-gates` | List + decision PASS/WARN/BLOCK, reasoning, approval workflow |
| 18 | Replay Center | `/p/:proj/replay/:findingId` | Artifact viewer, Run Replay button, output stream, expected/actual diff |
| 19 | Runner Fleet | `/p/:proj/runners` | Table online/offline, capabilities, heartbeat, rotate token |
| 20 | Cost & Quotas | `/p/:proj/cost` | Charts (over time, by model, by project), budget bars, alerts |
| 21 | Audit Log | `/p/:proj/audit` | Search, export, verify hash chain button |
| 22 | Settings Project | `/p/:proj/settings` | Project config, integrations, secrets |
| 23 | Settings Org | `/orgs/:org/settings` | Users, roles, billing, SSO config |
| 24 | Settings Integrations | `/p/:proj/settings/integrations` | Slack/Teams/Jira/GitHub/webhook |
| 25 | Onboarding wizard | `/p/:proj/onboarding` | 4 steps: detect stack → choose packs → choose agents → first run |

## 5. Component library (in `src/components/`)

| Component | Props | Description |
|---|---|---|
| `<PageHeader>` | `title`, `subtitle?`, `actions?` | h1 + actions row |
| `<KPICard>` | `label`, `value`, `delta?`, `icon?`, `trend?` | Compact metric card; no nesting |
| `<DataTable>` | `columns`, `data`, `filters?`, `pagination?` | TanStack Table wrapper, virtualized when >100 rows |
| `<StatusBadge>` | `severity` | P0/P1/P2/P3 + color tokens |
| `<ConfidenceBar>` | `value` (0-1) | Gradient bar |
| `<RunStatusPill>` | `status` | pending/running/passed/failed/cancelled/error |
| `<TimelineEvent>` | `event` | One row in the live stream |
| `<KanbanBoard>` | `columns`, `items`, `onMove` | DnD-kit for drag-and-drop |
| `<DiffViewer>` | `before`, `after`, `lang?` | Side-by-side, Monaco diff editor |
| `<CodeEditor>` | `language`, `value`, `onChange`, `schema?` | Monaco wrapper with schema validation |
| `<ArtifactViewer>` | `artifact` | Auto-switches on file type (image, json, log, har, etc.) |
| `<SkeletonTable>` | `rows`, `cols` | Section-specific loading |
| `<EmptyState>` | `icon`, `title`, `description`, `action?` | Standardized empty UX |
| `<ConfirmDialog>` | `title`, `description`, `danger?`, `onConfirm` | Modal with destructive variant |
| `<DateRangePicker>` | `value`, `onChange`, `presets?` | Today, 7d, 30d, custom |
| `<CommandPalette>` | `items` | ⌘K global navigation |
| `<NotificationBell>` | `unreadCount`, `onOpen` | Dropdown with recent events |
| `<UserMenu>` | `user` | Avatar + dropdown (settings, theme, logout) |
| `<OrgSwitcher>`, `<ProjectSwitcher>` | `current`, `options`, `onChange` | Searchable combobox |

## 6. Wireframes (textual) — must produce in the template

For each of these 6 critical screens, the template ships a static version with realistic mock data:

### 6.1 Dashboard

```
┌─ PageHeader ──────────────────────────────────────────────────┐
│ Dashboard — crm-backend           [Run smoke] [Run release ▾] │
└────────────────────────────────────────────────────────────────┘
┌─ KPI Row (4 cards) ───────────────────────────────────────────┐
│ [Open findings: 12 +3] [P0/P1: 2] [Cost MTD: $234] [Score:74] │
└────────────────────────────────────────────────────────────────┘
┌─ 2-col 60/40 grid ───────────────────────────────────────────┐
│ ┌─ Release Gate (60%) ─────────┐ ┌─ Top Findings (40%) ───┐  │
│ │ Status: BLOCK                │ │ P0 cross-tenant access │  │
│ │ • 1 P0 verified              │ │ P1 idempotency miss    │  │
│ │ • 2 P1 not triaged           │ │ P1 prompt injection    │  │
│ │ [View report]                │ │ [Open Findings →]      │  │
│ └───────────────────────────────┘ └────────────────────────┘  │
│ ┌─ Cost trend 30d (60%) ───────┐ ┌─ Runners (40%) ────────┐  │
│ │ <Recharts line chart>        │ │ • runner-prod-01 ✓     │  │
│ │                              │ │ • runner-ci ✓          │  │
│ │                              │ │ • runner-laptop ⊘      │  │
│ └───────────────────────────────┘ └────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

### 6.2 Runs list

```
PageHeader: Runs    [Filter: profile, status, since...] [New run]
DataTable cols: ID | Profile | Status | Duration | Findings | Cost | Started | Branch | Commit
Row click → /runs/:id
Row kebab menu: View, Replay all findings, Cancel, Delete artifacts, Compare with...
```

### 6.3 Run detail

```
PageHeader: Run #abc123    Status pill: COMPLETED    Profile: release    [Cancel] [Re-run] [Download bundle]
Tabs: [Overview · Timeline · Scenarios · Findings · Artifacts · Logs]

Overview tab layout:
  Stats grid (4 cards): Scenarios run | Pass rate | Findings | Cost
  Risks covered list
  Models used (Anthropic, OpenAI, local)
  Reproducibility breakdown (deterministic vs probabilistic)
```

### 6.4 Live Timeline

```
PageHeader: Live timeline — Run #abc123
Filter row: [Event type ▾] [Actor ▾] [Severity ▾] [Search]
Virtual scroll list of TimelineEvent components:
  [12:30:01.000] run.started — security profile
  [12:30:05.124] agent.started — aqa-security-redteamer
  [12:30:10.450] scenario.started — api-cross-tenant-read
  [12:30:13.012] probe.started — change project_id
  [12:30:14.301] oracle.failed — http_status got 200, expected not_in [200,201]
  [12:30:20.557] finding.created — P1 cross-tenant data leak
  ...
Auto-scroll to bottom unless user scrolled up (sticky "Live" indicator).
```

### 6.5 Findings Kanban

```
6 columns horizontal: New (3) · Needs Verification (5) · Verified (2) · Rejected (1) · Needs Regression (1) · Closed (12)
Each card: severity badge + title + risk_id tag + confidence bar + scenario id (mono)
Drag-and-drop between columns triggers a confirm dialog for state transitions that need motivation (e.g. Reject).
```

### 6.6 Risk Map viewer

```
DataTable cols: Risk ID | Area | Severity | Scenarios | Last checked | Coverage score | Status
Status pill: covered / partial / gap / stale
Row click → /risk-map/:id detail drawer (right-side, 40% width)
```

## 7. Empty / loading / error / permission states

Every screen must explicitly design:

- **Empty:** illustration + 1-line description + primary action (e.g. "No runs yet — start your first one")
- **Loading:** section-specific `<Skeleton>` (never a global spinner except on initial app boot)
- **Error:** title + 2-line description + `Retry` + link to support / docs
- **Permission denied:** title + role required + "Contact admin" link

## 8. Accessibility (WCAG 2.2 AA target)

- Every icon-only button: `aria-label` + `title` + visible focus ring
- Color contrast ≥ 4.5:1 for body text, ≥ 3:1 for large
- Keyboard navigation: Tab order matches visual order; ⌘K palette focusable; Esc closes dialogs
- Form errors with `aria-invalid` + `aria-describedby` pointing to error text
- Live regions for toasts and timeline updates (`aria-live="polite"`)
- Reduced motion respected (`prefers-reduced-motion`)

## 9. Playwright scenarios to plan upfront

The frontend dev should produce these test outlines while building the template (will be executed in Task 7 with real backend):

1. Login: happy + invalid creds + SSO redirect
2. Org switch + project switch
3. Dashboard: KPI render, click run button → opens drawer
4. Runs list: filter by profile, sort by duration, click row → detail
5. Run detail: tab navigation, download bundle button
6. Live timeline: filter by event type, scroll behavior (live mode toggle)
7. Findings Kanban: drag from New → Verified, confirm dialog reject motivation
8. Finding detail: view evidence, click Replay, see output stream
9. Risk Map viewer: open detail drawer, navigate to linked scenario
10. Risk Map editor: edit invariant, save with diff confirmation, rollback
11. Scenario Studio: edit YAML, see live validation error, fix, save draft
12. Packs: enable a pack, see signing status badge
13. Cost dashboard: change date range, see chart update
14. Audit log: search + verify hash chain action
15. Dark mode toggle: persists across reload

## 10. Folder structure (suggested)

```
packages/admin/
├── index.html
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.ts (only if needed; v4 prefers @theme)
├── biome.json (extends root)
├── package.json
├── src/
│   ├── main.tsx
│   ├── app.tsx
│   ├── routes/                  # TanStack Router file routes
│   │   ├── __root.tsx
│   │   ├── login.tsx
│   │   ├── orgs/...
│   │   └── p/$projectId/...
│   ├── components/
│   │   ├── ui/                  # shadcn copies
│   │   ├── layout/              # TopBar, SideNav, Breadcrumb
│   │   ├── data/                # DataTable, KanbanBoard
│   │   ├── editors/             # CodeEditor, DiffViewer, ArtifactViewer
│   │   ├── status/              # StatusBadge, RunStatusPill, ConfidenceBar
│   │   └── feedback/            # EmptyState, SkeletonTable, ConfirmDialog
│   ├── stores/                  # Zustand slices
│   ├── api/                     # TanStack Query hooks
│   ├── lib/                     # utils, formatters
│   ├── theme/                   # design tokens, dark mode util
│   └── styles/global.css
├── tests/
│   ├── unit/                    # Vitest + Testing Library
│   └── e2e/                     # Playwright .spec.ts
└── playwright.config.ts
```

## 11. Mock data fixtures (for the static template)

While the backend is in-flight, the template should load fixtures from `src/api/fixtures/` so every screen renders realistic data:

- 5 projects across 2 orgs
- 50 runs spanning 30 days
- 80 findings across all severities and statuses
- 12 risk areas with coverage variance
- 30 scenarios across 5 packs
- 6 runners (4 online, 2 offline)
- 14 days of cost data
- 200 audit log entries
- 100 timeline events for one live run

The fixtures double as Playwright seed data.

## 12. Deliverables (for the parallel template work)

- All 25 screens routed and rendering with fixtures
- Dark mode toggled working
- Responsive at 1280px and 1024px without overflow
- Keyboard navigation across all primary actions
- 6 wireframes above implemented pixel-pretty (designer can iterate)
- 15 Playwright scenario outlines written (skipped/`test.fixme`)
- Basic Vitest coverage on shared components (DataTable, StatusBadge, ConfidenceBar)
- README in `packages/admin/` with junior-friendly setup

Backend integration (replace fixtures with real API calls) is **Task 7**, not this parallel work.
