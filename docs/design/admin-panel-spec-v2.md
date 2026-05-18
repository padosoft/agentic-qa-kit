# `agentic-qa-kit` Admin Panel — Enterprise Design Brief (v2)

> **Audience.** A UI designer + frontend developer (human or AI) who has
> never seen this codebase before. You will deliver a production-grade
> React + Tailwind 4 template + Figma artifacts. Everything you need is
> below — do not assume access to the source code beyond what is quoted.
>
> **What you deliver back to me.**
> 1. A standalone Vite + React 19 + TypeScript strict + Tailwind 4 project
>    that renders **every** screen below with realistic fixture data, on a
>    real router (TanStack Router), with the full component library
>    extracted under `src/components/`.
> 2. A Figma file with the design system (tokens, components, all screens
>    in both light + dark mode + key empty / loading / error states).
> 3. A `DESIGN-NOTES.md` that explains every non-obvious decision (why this
>    contrast, why this animation curve, what variants exist).
>
> **The eventual integration target.** This template will be pasted into
> `packages/admin/` of a Bun-workspaces monorepo where 18 other packages
> already live and the data layer (`@aqa/schemas`, `@aqa/server`,
> `@aqa/compliance`, `@aqa/clustering`, `@aqa/auth`, `@aqa/admin-core`,
> `@aqa/methodology`) is locked. Do not invent fields that are not in this
> brief — match the types exactly. Anything you genuinely think is missing,
> raise as a question in `DESIGN-NOTES.md` rather than guessing.

---

## 0. Project context

`agentic-qa-kit` is the operating system for **agentic QA** — a framework
that turns coding agents (Claude Code, Codex CLI, Gemini CLI, GitHub
Copilot CLI) into senior QA engineers on your project. It ships:

- A **risk map** with severity, invariants, owners, framework anchors.
- **Scenario packs** for APIs / web UI / LLM agents / security /
  migrations.
- A **runner** that executes profiles deterministically and emits
  **findings** with 3-level reproducibility (`bug_level` / `scenario_level`
  / `agent_level`).
- A **hash-chained audit log** (`events.jsonl`) where every event is
  `sha256(prev_hash || canonical(rest))` — mechanically tamper-evident.
- A **server** + **runner fleet** for self-hosted multi-team use.
- A **methodology layer** mapping risks to STRIDE / FMEA / OWASP / OWASP-
  Agentic.
- A **compliance layer** with SOC2 TSC + ISO 27001:2022 Annex A controls.

The admin panel is the **single web surface** through which a QA lead, a
security architect, an SRE, an auditor, and a developer all consume the
same `.aqa/*` data. They have very different jobs.

The visual identity is **dark, technical, calm, opinionated**. Think Linear
+ Vercel dashboard + Grafana, with a Padosoft purple accent (`#8b5cf6`) for
AI-touched surfaces.

---

## 1. Audience personas (concrete, opinionated)

You are designing for five real people. Every interaction should make
sense for at least one of them on first contact.

| Persona | Job in the panel | Density appetite | Time-on-task |
|---|---|---|---|
| **QA Lead "Sara"** | Triages findings, runs release-gate profile, signs off | High — wants tables, no chrome | 4-6 hrs/day |
| **Sec Architect "Marco"** | Reads risk map, edits invariants, reviews STRIDE/OWASP coverage | High — comfortable with diagrams | 1-2 hrs/day |
| **SRE "Ada"** | Watches runner pool health, cost burn, queue depth | Medium — wants charts + alerts | Glance every 30 min |
| **Auditor "Helena"** | Reads audit log, downloads evidence bundles, verifies chain | Low — wants a guided flow | 1 hr/quarter |
| **Developer "Davide"** | Re-runs a failing scenario locally, copies `repro.sh` | Low — wants permalinks + copy buttons | When something fails |

Optimise for Sara's daily flow first; never make Helena's quarterly task
require Sara-level expertise.

---

## 2. Non-goals (do **not** design these)

- Marketing / landing pages.
- Mobile-first: laptop ≥ 1280px wide is the design target. Responsive down
  to 1024px is mandatory; below that show a "use a wider screen" notice.
- Native apps.
- A general dashboard builder. The screens are fixed; no drag-drop layout.

---

## 3. Tech stack — **locked, do not negotiate**

| Layer | Choice | Version | Notes |
|---|---|---|---|
| Framework | React | 19 | SPA only, no Server Components |
| Build | Vite | 6 | `@vitejs/plugin-react` |
| Language | TypeScript | 5.6+ | `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
| Styling | Tailwind CSS | 4 | `@theme` blocks, `@custom-variant` for dark |
| Component primitives | shadcn/ui | latest | Copied into `src/components/ui/` |
| Icons | lucide-react | latest | Inline SVG for custom AQA marks |
| Server state | TanStack Query | 5 | Optimistic updates required for editor screens |
| Client state | Zustand | 5 | Per-slice stores; React Context only for narrow trees |
| Routing | TanStack Router | 1.x | Typed routes, code-based |
| Forms | React Hook Form + Zod | latest | Schema-resolved errors |
| Charts | Recharts | latest | Only Recharts; visx allowed for one chart (live timeline) |
| Tables | TanStack Table | 8 | Virtualization where >100 rows |
| Date | date-fns | 4 | No moment |
| Editor | Monaco | latest | YAML + JSON + Markdown |
| Real-time | Native EventSource | — | SSE for tail-streams |
| Test unit | Vitest + Testing Library | latest | |
| Test e2e | Playwright | latest | Chromium baseline |
| Lint/format | Biome | 1.9+ | Single root config |

Do NOT swap any of these. If a piece is impossible, raise in
`DESIGN-NOTES.md`.

---

## 4. Design tokens (Tailwind 4)

Drop this verbatim into `src/styles/global.css`. Adjust hex values only if
WCAG AA fails; never invent new tokens — extend the table here first.

```css
@import "tailwindcss";

@custom-variant dark (&:where(.dark, .dark *));

@theme {
  /* ---- Surfaces (light defaults) ---- */
  --color-bg-base:        #f8fafc;   /* slate-50 — outer canvas */
  --color-bg-elevated:    #ffffff;   /* cards, tables */
  --color-bg-sunken:      #f1f5f9;   /* inset blocks (code, audit log) */
  --color-bg-overlay:     rgba(15, 23, 42, 0.4);

  /* ---- Foregrounds ---- */
  --color-fg-base:        #0f172a;   /* slate-900 */
  --color-fg-muted:       #475569;   /* slate-600 */
  --color-fg-subtle:      #94a3b8;   /* slate-400 */
  --color-fg-inverse:     #f8fafc;

  /* ---- Borders ---- */
  --color-border:         #e2e8f0;   /* slate-200 */
  --color-border-strong:  #cbd5e1;   /* slate-300 */
  --color-border-focus:   #6366f1;   /* indigo-500 */

  /* ---- Status (semantic, identical across modes unless WCAG fails) ---- */
  --color-status-success: #10b981;   /* emerald-500 */
  --color-status-warning: #f59e0b;   /* amber-500 */
  --color-status-danger:  #f43f5e;   /* rose-500 */
  --color-status-info:    #0ea5e9;   /* sky-500 */
  --color-status-ai:      #8b5cf6;   /* violet-500 — AI-generated content always */

  /* ---- Severity scale (findings) ---- */
  --color-sev-critical:   #b91c1c;
  --color-sev-high:       #ea580c;
  --color-sev-medium:     #ca8a04;
  --color-sev-low:        #65a30d;
  --color-sev-info:       #0ea5e9;

  /* ---- Type ---- */
  --font-sans: "Inter", "InterVariable", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", "JetBrainsMono", ui-monospace, monospace;

  --text-2xs: 11px;
  --text-xs:  12px;
  --text-sm:  13px;
  --text-md:  14px;
  --text-lg:  16px;
  --text-xl:  20px;
  --text-2xl: 24px;
  --text-3xl: 30px;

  --leading-tight: 1.2;
  --leading-normal: 1.45;
  --leading-loose: 1.7;

  /* ---- Radius (max 8px — never larger) ---- */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;

  /* ---- Density ---- */
  --row-h-compact:   28px;
  --row-h-normal:    36px;
  --row-h-comfy:     44px;
  --topbar-h:        48px;
  --sidenav-w:       240px;
  --sidenav-w-min:   56px;
  --rightpanel-w:    420px;

  /* ---- Motion ---- */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
  --motion-fast:   120ms;
  --motion-normal: 180ms;
  --motion-slow:   280ms;

  /* ---- Z-index scale ---- */
  --z-base:    0;
  --z-sticky:  10;
  --z-dropdown: 30;
  --z-modal:   40;
  --z-popover: 50;
  --z-toast:   60;
  --z-tooltip: 70;
}

.dark {
  --color-bg-base:        #020617;   /* slate-950 */
  --color-bg-elevated:    #0f172a;   /* slate-900 */
  --color-bg-sunken:      #0b1220;
  --color-fg-base:        #f1f5f9;
  --color-fg-muted:       #94a3b8;
  --color-fg-subtle:      #64748b;
  --color-fg-inverse:     #0f172a;
  --color-border:         #1e293b;
  --color-border-strong:  #334155;
  /* Status + severity unchanged unless contrast fails */
}
```

**Defaults**: dark mode is the **first-class** experience. Light mode must
work, but every screenshot in the marketing site is dark.

**Contrast budget**: WCAG AA for all text, AAA for the audit-log viewer and
the cost charts (auditor + SRE see these the longest).

---

## 5. Layout system

### 5.1 Frame
```
+--------------------------------------------------------------------+
|  TopBar  (h: 48)                                                   |
+------+-------------------------------------------------------------+
|      |  Breadcrumb (h: 28)                                         |
| Side |--------------------------------------------------------------
| Nav  |  PageHeader (h: 56, sticky on scroll)                       |
| 240  |--------------------------------------------------------------
|      |                                                             |
|      |  Main scroll area                                           |
|      |    - Tabs (when applicable)                                 |
|      |    - Content (cards / tables / form / split)                |
|      |                                                             |
|      |                                                             |
+------+-------------------------------------------------------------+

Right-side detail drawer (slides in, w: 420) when an item is clicked.
```

### 5.2 SideNav
- Collapsible to 56px icons-only (persisted in `localStorage.aqa.sidenav`).
- Sections (separator line between):
  1. **Work** — Dashboard, Runs, Findings, Risk map
  2. **Catalog** — Packs, Scenarios, Profiles, Agents
  3. **Operate** — Replay, Audit log, Cost, Queue (NEW)
  4. **Admin** — Users, Settings (gated by role)
- Active item: 2px left accent border in `--color-status-info`, label in
  `--color-fg-base`, slightly bold; inactive in `--color-fg-muted`.
- Tooltip on hover when collapsed.
- Footer pinned to bottom: version chip (`v1.3.0 · GA`), help link,
  GitHub link.

### 5.3 TopBar (left → right)
- **Org switcher** (chip with logo + name + ▼). Open: panel with
  search, recent, "create org" (admin only).
- **Project switcher** (same pattern). Defaults to the org's first
  project; project ID lives in URL hash for shareability.
- **Breadcrumb** (`Org / Project / Section / Detail`), clickable.
- **Global search ⌘K** — keyboard-first (see §11.3 below).
- **Notifications** bell with unread count.
- **Theme toggle** (cycles Light → Dark → System).
- **User menu** (avatar) — Profile, Sign out, switch role (impersonation,
  admin-only with audit event).

### 5.4 PageHeader contents
- H1 (title, ~20px semibold)
- Subtitle (small, muted)
- Right-aligned actions: primary action button + overflow menu
- Optional `Status pills` (e.g., `live` / `mock` data source mode)
- Optional `last refreshed Xs ago` + manual refresh button

---

## 6. Component library

Deliver **every component** below with TS prop types, storybook-style demo
page under `/dev/components`, light + dark previews, and explicit empty /
loading / disabled / error states.

### 6.1 Atoms

| Component | Variants | Notes |
|---|---|---|
| `Button` | primary / secondary / tertiary / danger / ghost / link; sizes xs/sm/md/lg; icon-only | Loading spinner replaces content; never both |
| `IconButton` | square + circle variants | Always has tooltip prop |
| `Input` | text / search / number / password / disabled | Prefix + suffix slots |
| `Textarea` | auto-grow on/off | Max-height before scroll |
| `Select` | single + multi + searchable | Use `Combobox` for searchable |
| `Combobox` | server-driven async | Debounce 200ms |
| `Switch` | sm/md | aria-pressed |
| `Checkbox` | with indeterminate | Tri-state for grouped tables |
| `RadioGroup` | horizontal + vertical | |
| `Slider` | single + range | Numeric input pair below |
| `Badge` | neutral/info/success/warning/danger/ai + severity tones | See `severityTone(sev)` helper |
| `Chip` | dismissable filter chip | Used in filter bar |
| `Tag` | static label | No interaction |
| `Avatar` | xs/sm/md/lg, with initials fallback | Status dot overlay |
| `Spinner` | sm/md/lg | Always paired with sr-only text |
| `Skeleton` | line / rect / circle | Use for >300ms loads |
| `Tooltip` | top/right/bottom/left | Delay 400ms |
| `KeyboardShortcut` | `<kbd>` styled | Cross-platform (⌘ on macOS, Ctrl elsewhere) |
| `CopyButton` | inline + standalone | Shows "Copied" 1.5s, ARIA live |
| `Progress` | linear + circular + indeterminate | |
| `Diff` | side-by-side + unified | Used in scenario history |

### 6.2 Molecules

| Component | Notes |
|---|---|
| `Card` | Header / Body / Footer slots; can be link or div |
| `KpiCard` | Icon + label + value + delta + sparkline |
| `EmptyState` | Illustration slot + title + body + 1-2 CTAs |
| `ErrorState` | Icon + title + message + retry button + "report" link |
| `LoadingShell` | Skeleton scaffold matching a screen layout |
| `Toast` | success/warning/danger/info/ai; auto-dismiss; action slot |
| `Alert` | inline banner; same tones |
| `Pagination` | numeric + prev/next + page-size |
| `FilterBar` | Chip-based; add/remove/clear-all; saved-filter dropdown |
| `SearchBar` | Inline; keyboard `/` focus |
| `Breadcrumb` | with ellipsis when >4 levels |
| `TabBar` | underline + pill variants |
| `Stepper` | horizontal + vertical; numbered + named |
| `StatusPill` | shape carries info (cap-rounded for runtime status) |
| `Dropdown` | menu / select / split-button |
| `Drawer` | right + bottom; locked / dismissible |
| `Modal` | sm/md/lg + confirmation variant |
| `Popover` | tooltipped controls |
| `DataPoint` | label + value + optional unit + delta |
| `Timeline` | vertical event list with icons |
| `CommandPalette` | `⌘K` opener |
| `ContextMenu` | right-click on rows |

### 6.3 Organisms

| Component | Notes |
|---|---|
| `AppShell` | TopBar + SideNav + Main |
| `DataTable<T>` | TanStack Table; virtualised >100; column resize / reorder / pin; sort multi; filter per column; saved views; CSV export; row selection; bulk actions; density toggle |
| `Kanban<T>` | columns by status; drag-drop between columns with confirm modal on terminal transitions |
| `Chart` wrappers | LineChart, BarChart, AreaChart, Heatmap, StackedBarChart — all from Recharts |
| `MonacoEditor` | YAML + JSON + Markdown; theme-bound; schema-validated; outline gutter |
| `LiveTerminal` | Tails stdout/stderr from SSE; preserves ANSI colours; copy-all; download `.log` |
| `AuditChainViewer` | Paste / load file / verify chain; result panel; per-event drill-down |
| `RiskMatrix` | 5×5 likelihood × severity grid; cells colour-coded; click to filter |
| `ReplayCommandPanel` | Tabs `repro.sh` / `repro.curl` / `repro.playwright.ts`; copy + download + run-locally instructions |
| `ScenarioTree` | Pack → scenario tree with badge counts; lazy-load children |
| `FindingsList` | List + cluster views; toggle |
| `OptimisticEditor<T>` | Wrap any form; `propose / commit / rollback`; conflict modal on stale base |
| `CostBudget` | Bar w/ threshold lines (50/80/100%); per-tenant per-month |
| `OnboardingChecklist` | Right-drawer; tracks `aqa init`, first risk, first finding |

### 6.4 Templates (compose organisms)

- `ListWithFilterTemplate` — FilterBar + DataTable + Pagination
- `MasterDetailTemplate` — DataTable left, Drawer right
- `SplitFormTemplate` — Form left, Live preview right (used for Risk editor, Scenario editor)
- `DashboardTemplate` — Grid of KpiCards + sections
- `WizardTemplate` — Stepper + step content + footer nav (used for `aqa init` and "create profile")

---

## 7. Screen inventory (30 screens)

Numbered for easy reference. Every screen MUST be designed with the
following states:

- **Loading** — skeleton matching the final layout, not a generic spinner.
- **Empty** — illustration + copy + primary CTA.
- **Error** — explicit message, retry, link to logs / support.
- **Partial** — when only some queries succeeded.
- **Permission-denied** — explicit "you need role X" with link to admin.
- **Mock vs live banner** — visible top-right when `VITE_AQA_SERVER_URL` is
  unset, badge "mock"; when set and last fetch succeeded, badge "live"; when
  set and fetch failed, banner "live fetch failed — showing nothing".

### Section A — Work (daily QA flow)

#### A1. Dashboard `/`
**Audience:** Sara (QA Lead), Ada (SRE) at glance.

Layout:
- 4 `KpiCard`s in a row (12-col grid, span 3 each):
  - Runs (last 24h) — count + delta vs prev 24h + sparkline
  - Completed — count
  - Open findings — split critical/high/medium/low as colored dots
  - Spend USD (current month) — value + delta + progress to budget cap
- 2 large cards (span 6 each):
  - **Last run** — id, profile, status, started, duration, findings; click → A3 detail
  - **Top findings** — top 5 by `worst_severity`, severity + summary + scenario; click → A6 detail
- 1 wide card (span 12): **Run activity heatmap** — past 30 days × hours, intensity = run count

Interactions:
- Click KPI → filtered route (e.g. Open findings → Findings filtered by status open)
- Hover sparkline → tooltip with day values
- "Last refreshed" + manual refresh + auto-refresh toggle (default off; cache TTL 30s)

#### A2. Runs `/runs`
**Audience:** Sara, Ada.

Layout: `ListWithFilterTemplate`.

Columns:
- ID (mono, link to A3)
- Profile
- Started (relative + absolute on hover)
- Duration (mm:ss)
- Findings (number, colored by max severity)
- Tokens / Cost (USD with currency)
- Status (StatusPill: succeeded / failed / running / aborted / budget_exceeded / pending)
- Trigger (manual / scheduled / api / agent)
- Actions (⋯: cancel if running, re-run, copy permalink)

Filters:
- Status multi-select
- Profile multi-select
- Date range
- Triggered by (user lookup)
- Has findings (yes/no)
- Cost > $X

Bulk actions on selected rows:
- Cancel (only running)
- Compare runs (pivots to A4 with run IDs)
- Export selected to CSV

States:
- Empty (filtered): "No runs match your filters" + Clear filters
- Empty (zero): EmptyState w/ "Trigger your first run" → command palette to scaffold

#### A3. Run detail `/runs/$runId`
**Audience:** Sara, Davide.

Layout: header + tabs:
- **Overview** — config snapshot (profile, packs, llm, hashes), totals, started/finished, owner, trigger event
- **Findings** (count badge) — FindingsList scoped to run; severity histogram on top
- **Events** — Timeline of `run.start / scenario.start / probe.start / probe.end / scenario.end / run.end` with durations
- **Logs** — LiveTerminal (SSE while running; static snapshot when complete) with filter-by-scenario
- **Replay** — ReplayCommandPanel for the full run (re-runs the whole config)
- **Cost** — bar chart of cost per scenario; tokens breakdown

Top-right actions: re-run, cancel, download artifact bundle (`.zip` of `.aqa/runs/<id>/`), copy permalink.

#### A4. Run compare `/runs/compare?ids=a,b[,c]`
**Audience:** Sara investigating regressions.

Layout: side-by-side columns per run, common rows below:
- Config diff (config_snapshot hashes — highlight which fields differ)
- Findings diff (new in B, fixed in B, repeated)
- Cost diff
- Duration diff
- Event-count diff

Click a finding in the diff → drawer with detail.

#### A5. Findings `/findings`
**Audience:** Sara, Davide.

Top toggle: **Clusters** | **List** | **Kanban**.

**Clusters** (default): cards grouped by `signatureOf(scenario × risk × normalised summary)`. Each card shows worst_severity, count, representative summary, scenario_id, risk_id, verification_floor badge, member list collapsed (expand).

**List**: DataTable with columns id / severity / status / scenario / risk / floor / discovered_at / first-seen-run.

**Kanban**: columns Draft → Verified → Fixed → Rejected → Duplicate. Drag-drop with confirmation modal when crossing into a "terminal" column (Verified / Fixed / Rejected / Duplicate). Cards show severity, summary, scenario, risk. Filter chip bar above.

Interactions:
- Click card / row → drawer (A6 in drawer mode) or A6 full page (toggle pref)
- Bulk select + bulk transition (with reason field)
- Filter: severity, status, floor, scenario, risk, tag (owasp:*, owasp-agentic:*)

#### A6. Finding detail `/findings/$id`
**Audience:** Sara, Davide.

Tabs:
- **Overview** — summary, severity (editable by lead), status (with audit reason), scenario link, risk link, run link, owner
- **Evidence** — captured probe input/output, screenshots, network trace
- **Reproducibility** — 3-level table (bug_level / scenario_level / agent_level): deterministic, attempts, successes, artifact_path, seed, model_pinned
- **Replay** — ReplayCommandPanel scoped to this finding
- **Cluster** — sibling findings (same signature) across runs
- **History** — audit timeline of every status / severity change with actor + reason

Actions (top-right): change status (modal w/ reason), assign owner, link to issue tracker (deep link to GH/Jira/Linear), copy permalink.

#### A7. Risk map `/risk-map`
**Audience:** Marco, Sara.

Two views:
- **Matrix** (default) — RiskMatrix 5×5 (likelihood × severity), cells coloured by FMEA RPN. Click cell → A8 filtered.
- **By category** — Cards grouped by `risk.category` (auth / data / integrity / availability / confidentiality / integration / business_logic / ui_ux / compliance / agentic).

Bar above: filter by category, by tag (`owasp:*` etc.), by owner.

CTA: "Add risk" → open A8 in create mode.

#### A8. Risk editor `/risk-map/$riskId` (and `/new`)
**Audience:** Marco.

Layout: `SplitFormTemplate` — form left, **live STRIDE / FMEA / OWASP preview** right.

Fields:
- id (slug, auto-generated, editable until first save)
- title
- category (enum)
- severity (enum)
- likelihood (enum)
- invariants (list of strings; add/remove)
- owners (multi-select user)
- tags (free-form with autocomplete; suggests `owasp:a0X`, `owasp-agentic:a0X`)
- description (Markdown, Monaco)
- linked_scenarios (list, read-only — derived)

Right panel live-computes:
- STRIDE buckets (from category)
- FMEA RPN (severity × likelihood × detection; detection input on right panel)
- OWASP coverage (parsed from tags)
- `has_framework_anchor` boolean — turns red if false

Editor uses `OptimisticEditor` — propose / commit / rollback. Conflict modal on stale-base.

### Section B — Catalog

#### B1. Packs `/packs`
List of installed packs.

Columns: slug (mono) / version / signature (ShieldCheck green if signed; red if not) / scenarios count / risks count / installed_at / applies_when status (pass/skip/error against current project).

Actions: install (admin only — wizard), uninstall (confirm), view detail.

#### B2. Pack detail `/packs/$slug`
Tabs: Manifest, Scenarios, Risks, Signature, History.

Manifest tab: pretty-printed `pack-manifest.schema.json` content + raw YAML toggle.

Signature tab: cosign-style — public key fingerprint, signed-by, signed-at, manifest hash. Verify-now button (re-runs `scanPack`).

#### B3. Scenarios `/scenarios`
Tree view: pack → scenario. Filters: pack, risk, profile match, search.

Each leaf is a scenario card with id, title, oracle kind, last-run status.

#### B4. Scenario detail `/scenarios/$id`
Tabs: Spec (Monaco YAML with schema lint), Probes, Oracle, Last 10 runs, History.

Edit mode (admin only): OptimisticEditor; preview shows runner contract diff.

#### B5. Profiles `/profiles`
Table: name / packs (chip list) / execution_mode (sandbox/host) / budget_usd / last_run_at.

Top-right: "Create profile" → wizard.

#### B6. Profile detail `/profiles/$name`
Form to edit. Same OptimisticEditor pattern. Right panel: estimated cost per run based on historical data.

#### B7. Agents `/agents`
Table of supported coding agents (Claude, Codex, Gemini, Copilot). Columns: name / instruction files (chip list) / installed (yes/no) / last-updated.

Per-row action: "Install / update files" → modal showing the rendered files and a "write to repo" confirmation.

### Section C — Operate

#### C1. Replay `/replay`
Two-column. Left: searchable finding list. Right: ReplayCommandPanel for the selected finding.

Buttons:
- Verify (calls `aqa verify <finding-id>` via the runner)
- Copy `repro.sh` / `repro.curl` / `repro.playwright.ts`
- Download bundle (`.zip`)

When verify runs: live terminal panel slides up with SSE stream.

#### C2. Audit log `/audit`
Two panels, 2/3 + 1/3.

Left: **AuditChainViewer**
- Paste a `events.jsonl` text in textarea OR upload `.jsonl` file OR auto-load current project's chain.
- Verify button → re-walks the sha256 chain in-browser (Web Crypto async).
- Demo buttons: "Load good chain" / "Load tampered chain" (for documentation).
- Per-event drill-down list under verify result: kind, when, actor, hash, payload (click to expand JSON).
- Search box filters events by kind / actor / payload contents.

Right: **Result panel**
- Big OK / BROKEN status pill.
- Verified record count.
- First mismatch index + reason (when broken).
- Download verify report (signed PDF or JSON).

#### C3. Cost `/cost`
Top KPIs: month-to-date total / projected (linear extrapolation) / budget cap / utilisation %.

Charts:
- Bar chart spend per profile (stacked: input tokens / output tokens / non-LLM)
- Line chart daily spend over current month vs previous month
- Top 10 most expensive runs table

Alerts:
- 50% / 80% / 100% budget alert thresholds shown as dashed lines on the line chart.
- Banner if MTD > 80%.

Admin: edit budget cap (modal); set up alert recipients.

#### C4. Queue `/queue` (NEW — runner fleet operations)
**Audience:** Ada.

Layout:
- Top KPIs: pending jobs / in-flight / runners online / oldest pending age
- Live queue table: job id / payload preview / enqueued_at / leased_by / lease_expires_at / attempts
- Runner pool table: runner id / online / last heartbeat / current job / total jobs today

Actions: requeue stuck job, kill in-flight job (with reason), drain runner (mark for graceful shutdown).

#### C5. Notifications `/notifications`
Table of past notifications. Filters by kind (run.failed, finding.critical, budget.threshold). Per-row "mark unread".

### Section D — Admin (role-gated)

#### D1. Users `/admin/users`
Table: user / email / role / last_active / status.

Actions: invite, change role, deactivate, view login history.

Modal: per-user audit of role changes (audit log filter pre-applied).

#### D2. Roles `/admin/roles`
Table of `@aqa/auth` roles. Edit permissions (matrix of role × action).

#### D3. SSO `/admin/sso`
OIDC config: issuer URL, client_id, client_secret (write-only), allowed_domains, claim mappings.

Test button: "Test sign-in" → opens a dummy OIDC flow.

#### D4. Org/project `/admin/org`
Settings: org name, logo upload, default project, time zone, locale.

Project subsection: list of projects + add new + archive.

#### D5. API tokens `/admin/tokens`
Personal + service-account tokens. Create → modal showing token ONCE; revoke; last-used; scopes.

#### D6. Audit (admin view) `/admin/audit`
Same as C2 but with broader filters (all actors, all kinds), bulk download evidence bundle (admin role required).

### Section E — Self-serve

#### E1. Settings (per-user) `/settings`
Theme (light/dark/system), density (compact/normal/comfy), default landing page, default table page size, notification preferences.

#### E2. Onboarding `/onboarding`
First-launch wizard:
1. Welcome
2. Detect repo (read `.aqa/`)
3. Run `aqa init` (if not present) — embedded shell preview
4. Pick first pack
5. Run first scan
6. Review first findings

Persisted: don't show again until repo changes.

#### E3. 404 / 403 / 500
Branded error pages. 403 says which role is required.

---

## 8. Interaction patterns

### 8.1 Loading
- **<300ms** — no skeleton (avoid flicker)
- **300-1500ms** — skeleton matching the layout
- **>1500ms** — skeleton + inline spinner; if >5s offer "this is taking longer than usual — retry / report"

### 8.2 Empty
- Always paired with a primary CTA.
- Illustration is a clean SVG line drawing (purple accent on key element).
- Copy: state what's empty AND why it might be empty.

### 8.3 Error
- **Network/auth** — banner: "Live fetch failed: <reason>. Check connection / token."
- **Permission** — branded 403 page with "You need role: <role>. Ask your admin."
- **Schema** — banner: "Server returned a payload we don't understand. <link to bug report>."
- **Crash** — error boundary screen with stack hash + "Reload" + "Report".

### 8.4 Optimistic editing
For Risk / Scenario / Profile / Pack edit:
- Save → immediate UI update + dim "saving" indicator
- Server confirms → indicator clears
- Server rejects → revert + toast w/ reason + "Try again"
- Conflict (stale base) → modal: "Someone else changed this. Show their changes / Override / Cancel"

### 8.5 Destructive actions
- Always confirm.
- For terminal actions (delete user, force-kill run): confirmation requires typing the resource name.
- Toast confirms outcome; provides Undo for 10 seconds where reversible.

### 8.6 Real-time
- LiveTerminal: SSE; if connection drops, banner "reconnecting (3s)…"; auto-reconnect with exponential backoff up to 30s.
- Queue page: poll every 5s OR SSE for `queue.changed` events.
- Notifications bell: WebSocket; degrade to 30s poll.

### 8.7 Keyboard shortcuts (global)
| Shortcut | Action |
|---|---|
| `⌘K` / `Ctrl+K` | Command palette |
| `/` | Focus the in-page search |
| `g d` | Go to Dashboard |
| `g r` | Go to Runs |
| `g f` | Go to Findings |
| `g a` | Go to Audit log |
| `?` | Open keyboard help modal |
| `Esc` | Close drawer / modal / popover |
| `Ctrl+\` | Toggle sidenav |
| `Ctrl+J` | Toggle theme |

Command palette (⌘K):
- Quick nav (route names)
- Quick actions ("create profile", "start run", "verify chain")
- Quick search (runs by id, findings by id, scenarios by id)
- Recent items

### 8.8 Drag and drop
- Findings kanban (status transitions)
- DataTable column reorder
- Onboarding step reorder (admin)

All DnD must be keyboard-accessible (arrow-keys + space to grab).

---

## 9. Forms

- React Hook Form + Zod resolver. **Every** form must:
  - Disable submit when invalid (and show why)
  - Show field-level errors inline (below input, in danger tone)
  - Show a top-of-form summary if >3 errors
  - Persist unsaved changes warning on navigation away
  - Be navigable by Tab order matching visual order
  - Confirm destructive cancels ("discard changes?")
- Number inputs: arrows + scroll-wheel disabled by default
- Currency inputs: format-on-blur, parse-on-focus, never lose precision
- Date/time: ISO storage, locale display

---

## 10. Tables (TanStack Table)

Mandatory features for `DataTable<T>`:
- Sort: click column header; multi-sort with Shift-click
- Filter: per-column popover; chip representation in FilterBar above
- Search: free-text across visible columns
- Column visibility toggle + reorder + resize + pin (left/right)
- Saved views: name + filter set + column set + sort; share via URL
- Row selection: checkbox col; persists across pagination
- Bulk actions: action bar slides in at the top when ≥1 selected
- Density toggle: compact / normal / comfy (CSS var)
- Virtualisation when >100 rows (TanStack virtual)
- Empty rows footer when filtered to zero
- Sticky header
- Sticky first column on narrow viewport
- CSV / JSON export of current view
- "Copy as table" (markdown)
- "Permalink" of current view

ARIA: `grid` role, `aria-rowindex`, `aria-colindex`; keyboard navigation
(arrow keys move focus across cells; `Enter` activates cell action).

---

## 11. Charts (Recharts)

Style:
- No gridlines except subtle horizontal at major ticks
- Y-axis: clipped to data range with 10% padding
- Colors from semantic tokens; never raw hex in component code
- Tooltips: dark surface, monospace numbers, full date in footer
- Legends: clickable to hide/show series; double-click to solo
- Time axis: smart tick reduction; show "5d ago" labels not "May 13"
- Empty state: bordered placeholder with "No data in selected range"
- Loading state: shimmer band across the chart area

### 11.1 Heatmap (Dashboard run activity)
- Day × hour grid; cell colour = run count
- Hover cell → tooltip with run list
- Click cell → drill-down to Runs filtered to that hour

### 11.2 Live timeline (visx; the only non-Recharts chart)
- Used in Run detail "Events" tab
- Horizontal swim lanes: scenarios
- Bars: probe executions (length = duration, colour = outcome)
- Hover bar → tooltip
- Click → finding (if probe produced one) or scenario detail

---

## 12. Editors

### 12.1 Monaco — YAML
- Schema-validated against the relevant `@aqa/schemas` JSON Schema
  (manifest, scenario, risk-map, profile)
- Lint errors in gutter
- Outline panel (right-side toggle)
- Folding
- Find/replace (`⌘F`)
- "Format" action (Prettier-yaml)

### 12.2 Monaco — JSON
- Same; used for `agentic-qa-kit.yaml` raw view, finding JSON dump

### 12.3 Markdown editor
- Two modes: WYSIWYG via TipTap OR raw Monaco — toggle in header
- Slash commands: `/code`, `/quote`, `/table`, `/link-finding`, `/link-scenario`
- Mention `@user` autocompletes from `@aqa/auth` users

---

## 13. AuditChainViewer (organism) — detailed spec

Because this is the panel auditors look at.

```
+----------------------------------------------------------+
| Paste events.jsonl  | Result                             |
| or upload .jsonl    |                                    |
|                     |     [LARGE STATUS PILL]            |
| [textarea, mono]    |       CHAIN OK                     |
|                     |     1234 records verified          |
| [Load good chain]   |                                    |
| [Load tampered]     |   First record:   2026-05-18 ...   |
| [Upload .jsonl]     |   Last record:    2026-05-18 ...   |
| [Verify chain]      |   Verified actor identities: 3     |
|                     |                                    |
|                     |   [Download verify report]         |
+----------------------------------------------------------+
|  Event timeline (collapsible)                            |
|  ▾ run.start  · 2026-05-18T08:14 · sara@padosoft         |
|       prev_hash: 000000…    hash: ab2f9e…    OK          |
|  ▾ scenario.start · ... · ...                            |
|  ▸ probe.start · ... · ...                               |
|  ▾ finding.emitted · ... · ...                           |
|        ⚠ HASH MISMATCH at index 47                       |
|          expected: 8f3c…   got: 2b91…                    |
|  ▸ ...                                                    |
+----------------------------------------------------------+
```

Required behaviour:
- Verify runs in a Web Worker (chains can be 50k+ events)
- Progress bar during verify; cancellable
- When broken: highlight the bad row in red; auto-scroll to it
- Downloadable PDF report includes: project, time of verify, verifier
  (current user), chain head hash, result, first mismatch (if any),
  signed by the panel's session token

---

## 14. Multi-tenant flow

Hierarchy: **Org → Project → Resource**.

URL pattern: `/o/$orgSlug/p/$projectSlug/{section}`.

Switcher behaviour:
- Switching org → land on that org's last-used project's dashboard
- Switching project (within org) → land on the same section
- Permissions are per-org-per-project (RBAC scoped to project; admin
  scoped to org)
- The TopBar chip shows `Org / Project` and is itself the switcher

Background: every query is keyed by `(org, project)`. Switching invalidates
the cache for old keys.

---

## 15. Auth flow

- Sign-in page (`/sign-in`): OIDC provider buttons + dev-mode local creds
- Idle timeout: 30 min default; warning toast at 25 min with extend button
- Session refresh: silent, in-flight requests retried after refresh
- Sign-out: confirm if unsaved changes detected
- Impersonation (admin only): banner across top reading "Impersonating
  $user · Stop"; every action logged to audit

---

## 16. Accessibility (WCAG AA mandatory)

- Every interactive element keyboard-focusable
- Focus ring: 2px outline in `--color-border-focus` with 2px offset; never
  remove `outline`, only restyle
- Skip-to-content link at top
- ARIA landmarks: `<header>`, `<nav>`, `<main>`, `<aside>`
- Live regions for toasts (`role="status"`) and async results (`aria-live="polite"`)
- Charts: data table fallback toggle (`<table>` view of the same data)
- Forms: every input has a label (visible or sr-only)
- Color is never the sole signal — pair with icon or text
- prefers-reduced-motion respected: collapse all transitions
- High-contrast theme variant: `:root[data-contrast="high"]` boosts
  borders and text contrast

---

## 17. i18n (hook points)

- All copy lives in `src/i18n/en.ts` (and structure for `it.ts`, etc.)
- Use ICU messages (plural / select)
- No string concatenation in JSX
- Date / number formatting via `Intl`
- Right-to-left support deferred but layout uses logical properties
  (`padding-inline-start` not `padding-left`)

---

## 18. Performance budget

| Metric | Target |
|---|---|
| First paint (cold) | < 1.0s |
| TTI | < 2.5s |
| Initial JS gzip | < 200 KB |
| Initial CSS gzip | < 20 KB |
| Largest contentful paint | < 1.5s |
| Per-route lazy chunk | < 80 KB gzip |

Techniques:
- Route-based code splitting
- Component-level dynamic import for heavy organisms (Monaco, charts,
  AuditChainViewer)
- Prefetch on hover for nav items
- Web Workers for chain verification + clustering
- Memoise expensive table cells

---

## 19. Motion (subtle, purposeful)

| Surface | Motion | Duration | Curve |
|---|---|---|---|
| Drawer in/out | translateX + fade | 180ms | `ease-out` |
| Modal in | scale 0.96 → 1 + fade | 120ms | `ease-out` |
| Toast in | translateY + fade | 180ms | `ease-out` |
| Tab change | underline slide | 120ms | `ease-in-out` |
| Hover state | color only (no movement) | instant | — |
| Chart redraw | path interp | 280ms | `ease-out` |
| Live terminal | text reveal | none (instant) | — |

NEVER animate text content (no typing effect). Respect
`prefers-reduced-motion`.

---

## 20. Empty-state illustrations

Style: minimal line art, single accent color (`--color-status-ai`).

Required illustrations:
- **Empty findings**: clipboard with a checkmark
- **Empty runs**: rocket on a launchpad
- **Empty risks**: shield with a question mark
- **Empty packs**: stacked boxes
- **Empty audit log**: padlock with chain
- **404**: compass with broken needle
- **403**: shield with crossed key
- **500**: server with sparks
- **No data in chart**: bar chart with one missing bar
- **Onboarding step 1**: hand holding terminal

Deliver as monochrome SVG, currentColor-friendly, max 200×200.

---

## 21. Data layer — exact types you must use

The admin reads from `@aqa/schemas`. Don't redefine these shapes; import
them. Quoted here so you can mock without seeing the real package:

```ts
// from @aqa/schemas — finding.ts
export const Status = z.enum(['draft', 'verified', 'rejected', 'duplicate', 'fixed']);
export const Severity = z.enum(['critical', 'high', 'medium', 'low', 'info']);
export const VerificationFloor = z.enum(['bug_level', 'scenario_level', 'agent_level']);

export const Finding = z.object({
  schema_version: z.literal('1'),
  id: z.string(),                       // long slug
  run_id: z.string(),
  scenario_id: z.string(),
  risk_id: z.string(),
  severity: Severity,
  status: Status,
  title: z.string(),
  summary: z.string().optional(),
  discovered_at: z.string().datetime(),
  verification_floor: VerificationFloor,
  reproducibility: z.record(VerificationFloor, z.object({
    deterministic: z.boolean(),
    attempts: z.number().int().nonnegative(),
    successes: z.number().int().nonnegative(),
    artifact_path: z.string().optional(),
    seed: z.string().optional(),
    model_pinned: z.string().optional(),
  })),
  tags: z.array(z.string()).default([]),
  owners: z.array(z.string()).default([]),
});

// from @aqa/schemas — run.ts
export const RunState = z.enum(['pending', 'running', 'succeeded', 'failed', 'aborted', 'budget_exceeded']);

export const Run = z.object({
  schema_version: z.literal('1'),
  id: z.string(),
  started_at: z.string().datetime(),
  finished_at: z.string().datetime().optional(),
  state: RunState,
  project: z.string(),
  profile: z.string(),
  execution_mode: z.enum(['sandbox', 'host']),
  config_snapshot: z.object({
    profile: z.string(),
    execution_mode: z.enum(['sandbox', 'host']),
    packs: z.array(z.string()).default([]),
    llm: z.object({
      provider: z.string(),
      model_id: z.string(),
    }).optional(),
    config_hash: z.string(),                            // sha256
  }),
  totals: z.object({
    scenarios: z.number().int().nonnegative().default(0),
    findings: z.number().int().nonnegative().default(0),
    probes: z.number().int().nonnegative().default(0),
    llm_tokens_in: z.number().int().nonnegative().default(0),
    llm_tokens_out: z.number().int().nonnegative().default(0),
    llm_cost_usd: z.number().nonnegative().default(0),
  }),
  artifact_dir: z.string(),
});

// from @aqa/schemas — risk-map.ts (subset)
export const RiskCategory = z.enum([
  'auth', 'data', 'integrity', 'availability', 'confidentiality',
  'integration', 'business_logic', 'ui_ux', 'compliance', 'agentic',
]);
export const Likelihood = z.enum(['rare', 'unlikely', 'possible', 'likely', 'almost_certain']);

export const Risk = z.object({
  id: z.string(),
  category: RiskCategory,
  title: z.string(),
  severity: Severity,
  likelihood: Likelihood,
  invariants: z.array(z.string()).default([]),
  owners: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),               // owasp:a01, owasp-agentic:a02
});

// from @aqa/schemas — event.ts (audit log)
export const Event = z.object({
  schema_version: z.literal('1'),
  kind: z.enum([
    'run.start', 'run.end', 'scenario.start', 'scenario.end',
    'probe.start', 'probe.end', 'finding.emitted', 'finding.status_changed',
    'pack.installed', 'pack.uninstalled', 'profile.updated',
    'user.signed_in', 'user.signed_out', 'role.changed',
    'budget.threshold', 'queue.changed',
  ]),
  at: z.string().datetime(),
  actor: z.string(),                                   // user id / runner id / "system"
  prev_hash: z.string(),                               // sha256 hex (64 chars, zeros for first)
  hash: z.string(),                                    // sha256(prev_hash || canonical(rest))
  payload: z.record(z.unknown()).default({}),
});
```

Anything not in this section is not a real field — don't invent fields.

### 21.1 Server endpoints you can call (current)
- `GET /api/runs` → `{ runs: Run[] }`
- `GET /api/runs/:id` → `{ run: Run }`
- `GET /api/findings` (`?run_id=…`) → `{ findings: Finding[] }`
- `GET /api/findings/:id` → `{ finding: Finding }`
- `GET /api/runner/jobs/next` → `{ job: { ... } | null }` (runner-only)

### 21.2 Endpoints expected (mock for now; will land)
- `GET /api/packs`, `GET /api/packs/:slug`
- `GET /api/profiles`, `GET /api/profiles/:name`
- `GET /api/risks`, `GET /api/risks/:id`
- `GET /api/agents`
- `GET /api/cost/summary?from=…&to=…`
- `GET /api/queue`
- `GET /api/users`, `POST /api/users/:id/role`
- `GET /api/audit?from=…&to=…` (SSE for live tail at `/api/audit/stream`)

For any endpoint not yet shipped, the screen MUST work against in-bundle
mocks AND display a `mock` badge.

---

## 22. URL / state contract

- Every filterable list keeps filters in URL query (`?status=draft&severity=critical`)
- Sort state in URL (`?sort=discovered_at:desc`)
- Pagination in URL (`?page=3&pageSize=50`)
- Open drawer in URL (`?drawer=/findings/$id`)
- Selected tab in URL (`#findings`)
- Theme + density in localStorage
- Saved-view name in URL (`?view=criticals-open`)
- ⌘K state is local
- Permalink button on every detail page copies the current URL

This is non-negotiable — auditors need to share permalinks.

---

## 23. Permissions matrix

| Role | View dashboard | Trigger run | Edit risk | Edit scenario | Edit profile | Install pack | Verify chain | Edit users |
|---|---|---|---|---|---|---|---|---|
| `viewer` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| `qa-lead` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| `sec-architect` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| `sre` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| `auditor` | ✅ (read-only) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| `admin` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

Permission denials must say which role would unlock the action.

---

## 24. Testing strategy

- **Vitest + Testing Library** for every organism with non-trivial logic:
  `DataTable` (sort, filter, virtualisation), `MonacoEditor` (schema
  validation pass-through), `OptimisticEditor` (conflict path),
  `AuditChainViewer` (good + tampered chains).
- **Playwright** smoke for every route loads and the keyboard `⌘K`
  command palette navigates.
- **Storybook** entry per atom & molecule.
- 80%+ coverage on `src/components/` excluding generated route tree.

---

## 25. Visual style references (calibration only — do not copy)

Look at, then deliberately diverge from:
- **Linear** — for type rhythm, density, command palette feel
- **Vercel dashboard** — for the calm dark, the soft glow on focus
- **Grafana** — for charts that take operators seriously
- **Sentry** — for the finding-detail page layout
- **GitHub** — for the audit log presentation

The result must feel like a **technical instrument**, not a SaaS toy.
Round corners are NEVER more than 8px. No glass-morphism. No gradients
except a single subtle purple-to-indigo on the top-bar logo mark.

---

## 26. Deliverables checklist (acceptance)

When you hand back, I check the following:

### React project
- [ ] `bun install && bun run dev` boots on `http://localhost:5173`
- [ ] Every route in §7 renders with mock data
- [ ] Every component in §6 has a Storybook entry
- [ ] Light + dark mode toggle works
- [ ] Compact / normal / comfy density toggle works
- [ ] `⌘K` opens command palette and navigates
- [ ] Keyboard shortcuts in §8.7 work
- [ ] Zero `any` in the codebase outside `node_modules`
- [ ] Biome lint passes
- [ ] Vitest + Playwright pass
- [ ] Bundle within budget (§18)

### Figma
- [ ] One page per route in §7, light + dark
- [ ] Components page mirrors §6 atoms/molecules/organisms
- [ ] Tokens page lists every CSS variable from §4
- [ ] States documented (loading / empty / error / partial / denied)
- [ ] Auto-layout used everywhere; no fixed-position children

### Docs
- [ ] `DESIGN-NOTES.md` covers every decision that isn't obvious from the
  spec
- [ ] `README.md` shows: how to run, how to swap mock for live, how to
  add a route, how to add a column to a DataTable
- [ ] Inline JSDoc on every exported component prop type

---

## 27. File structure (target)

```
packages/admin/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── biome.json                          # extends root
├── src/
│   ├── main.tsx
│   ├── styles/
│   │   └── global.css                  # §4
│   ├── router-instance.ts              # TanStack Router register
│   ├── route-tree.tsx                  # all routes
│   ├── routes/                         # one file per screen if many tabs
│   │   ├── runs/
│   │   │   ├── index.tsx               # /runs
│   │   │   ├── $runId.tsx              # /runs/$runId
│   │   │   └── compare.tsx
│   │   ├── findings/
│   │   ├── risk-map/
│   │   ├── ...
│   ├── components/
│   │   ├── ui/                         # atoms (shadcn copies)
│   │   ├── data/                       # DataTable, KpiCard, ...
│   │   ├── chrome/                     # AppShell, TopBar, SideNav
│   │   ├── audit/                      # AuditChainViewer
│   │   ├── editor/                     # MonacoEditor wrappers
│   │   ├── kanban/                     # FindingsKanban
│   │   ├── replay/                     # ReplayCommandPanel, LiveTerminal
│   │   ├── risk/                       # RiskMatrix
│   │   └── illustrations/              # SVGs
│   ├── state/
│   │   ├── theme.ts                    # Zustand
│   │   ├── density.ts
│   │   ├── tenant.ts                   # org + project
│   │   └── notifications.ts
│   ├── data/
│   │   ├── api.ts                      # live + mock split
│   │   ├── mock.ts
│   │   ├── audit.ts                    # in-browser hash-chain verifier
│   │   ├── cluster.ts                  # in-browser clusterer
│   │   └── workers/
│   │       ├── audit.worker.ts
│   │       └── cluster.worker.ts
│   ├── hooks/
│   │   ├── useDebounced.ts
│   │   ├── useKeyboard.ts
│   │   ├── usePermissions.ts
│   │   └── useTenant.ts
│   ├── i18n/
│   │   ├── en.ts
│   │   └── index.ts
│   └── lib/
│       ├── format.ts                   # date / number / currency
│       └── permissions.ts
├── test/
│   ├── unit/                           # Vitest
│   └── e2e/                            # Playwright
├── stories/                            # Storybook
├── public/
└── DESIGN-NOTES.md
```

---

## 28. Questions you may have — answer in `DESIGN-NOTES.md`

If any of these apply to your output, document the decision:
- Did you swap an enum value? **Don't.** If you absolutely must, raise it.
- Did you add a screen not in §7? **Don't.** Same.
- Did you add a token not in §4? **Don't.** Same.
- Did you compromise dark-first? Explain why.
- Did you use a different state library? **Don't.**
- Did you ship without ⌘K? Explain why.

---

## 29. Out of scope (explicitly)

- Marketing pages, public website
- Billing / Stripe — handled elsewhere
- Realtime collaborative cursors (Figma-style) — not required
- Custom dashboard builder
- Embedded chat support widget — use existing support link

---

## Final note

This panel is the **public face** of `agentic-qa-kit` to enterprise
buyers. Auditors will demo it to other auditors. Developers will keep it
open all day. Density and precision beat decoration every time. When in
doubt: **make it more legible, not more interesting.**

Ship it.
