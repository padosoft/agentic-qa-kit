# Progress

> Live state of the repository. Update after every meaningful work increment (sub-task done, blocker hit, decision made). Entries dated `YYYY-MM-DD`. Newest first.

## How to read this file

- Each dated section is a single working day (or session).
- Bullets are chronological inside a day.
- Each bullet states **what changed**, **why**, and **what's next** where relevant.
- After a session interruption, the last bullet of the latest day is the resume point.

## 2026-09-17

## 2026-09-18

- **Connected hardened shell probes to the sandbox boundary.** Orchestrator
  `security` and `release-gate` runs now create a `ContainerSandbox` when the
  host has not supplied a driver; shell probes execute through the bounded OCI
  tool boundary, while HTTP remains origin-scoped and smoke profiles remain
  explicit/no-sandbox. Evidence: real `aqa run` shell journey with an injected
  sandbox executor passes, kit suite **38 passed / 0 failed**, plus existing
  hosted OCI runtime coverage. This is not a claim of VM isolation or live
  Docker proof for every deployment. Next: enforce pinned production image and
  continue KMS/WORM, PITR/restore and IdP/mTLS evidence.

- **Added an explicit scenario isolation policy.** Profiles now support
  `parallel`, `grouped` and `serial` scheduler modes; scenarios can declare an
  `isolation_group`, and grouped scenarios are serialized while independent
  groups retain bounded parallelism. Start events record the effective policy
  and key. This prevents a scheduler-level shared-state race but is explicitly
  not container/VM isolation or a tenant reset. Evidence: real `aqa run`
  complete journey proves two scenarios in one group never overlap; schema and
  kit tests **79 passed / 0 failed**. Next: continue the remaining provider and
  deployment evidence (sandbox wiring, KMS/WORM, PITR/restore, IdP/mTLS).

- **Fixed prefixed S3 Object Lock verification.** Retention verification now
  checks the exact provider key for both the artifact and its metadata object;
  a configured prefix is no longer applied twice to the metadata check. The
  S3 retention journey asserts both `HeadObject` keys and passes 6/6 locally.
  Next: continue the remaining deployment-grade evidence (real KMS/WORM,
  PITR/restore, IdP/mTLS and provider-backed commerce journeys).

- **Made profile parallelism operational.** `aqa run` now discovers scenarios
  before scheduling them through a bounded worker pool capped by the profile's
  `parallelism`, while preserving unique finding seeds, cooperative
  cancellation, budget checks, and discovery-ordered run summaries. Audit
  events may interleave by completion time and retain `dispatch_order` so the
  concurrency trade-off is explicit. Evidence: complete kit parallelism
  journey, workspace typecheck/build/lint and 729-test suite pass. Next:
  continue production evidence and external-provider validation.

- **Added executable scenario preconditions.** `Scenario.preconditions` now
  accepts a backwards-compatible structured `{ id, probe, oracle }` contract.
  `runScenario()` executes those checks before scenario steps, records their
  probe/oracle evidence, runs cleanup after a failed setup check, and returns
  `blocked` without emitting a security finding. Existing descriptive string
  preconditions remain valid but are explicitly non-executable. Evidence:
  runner and schema tests pass, schema JSON regenerated, Biome clean. Next:
  close the remaining execution-policy gap around configured parallelism.

- **Connected signed-pack policy to execution.** `aqa run --require-signed-packs`
  now refuses every discovered pack unless its canonical manifest digest,
  trusted Ed25519 signature and full file content digest all verify before any
  scenario runs. The CLI accepts only an operator public-key trust root from
  `AQA_PACK_TRUSTED_KEYS_JSON`; local authoring remains opt-in. Kit typecheck,
  lint and targeted complete run tests pass. Next: continue deployment-grade
  evidence and real provider drills.

- **Anchored replay to the original defect identity.** Findings now persist a
  SHA-256 `failure_fingerprint` of the failed-oracle set, and `aqa verify`
  passes it into every retry. A different oracle failure can no longer be
  reported as deterministic merely because it also produced a finding.
  Schema, runner and complete CLI verification tests cover the contract.
  Next: continue the remaining operational proof (real KMS/WORM/PITR/IdP and
  external security validation).

- **Closed the audit-serving false-green boundary.** `GET /api/runs/:id/events`
  now verifies the complete stored hash chain before returning evidence and
  returns bounded `AUDIT_CHAIN_INVALID` on tampering, matching the existing
  risk-coverage projection. Evidence: server integration regression plus full
  local gate suite. Next: operational evidence and real infrastructure drills.

- **Added an explicit production-readiness doctor mode.** `aqa doctor
  --production` now checks only configuration prerequisites for durable store,
  queue, S3/Object Lock retention, runner authentication, audit checkpoints and
  OTLP, never prints values and never confuses configuration with live provider
  evidence. Missing prerequisites fail (or warn for checkpoint/observability)
  with actionable remediation. Next: execute this contract against a real
  deployment and retain provider evidence.

- **Hardened enterprise pack supply-chain enforcement.** The scanner now has an
  explicit `requireSignature` policy; the admin/server import boundary enables
  it by default, rejects unsigned manifests before persistence, and preserves
  an explicit opt-out only for local/dev callers. Scanner, API and admin tests
  cover the policy. Next: continue the operational evidence layer (real trust
  root rotation, KMS/WORM/PITR and external security validation).

- **Closed the custom pack-resource gap.** `aqa run` now loads and validates
  every manifest-listed declarative probe/oracle definition before execution,
  rejects missing/duplicate/escaping/symlinked resources, and expands explicit
  `kind: custom` + `with.ref` references into built-in contracts. Resource
  files are already inside the content-digest boundary; no executable pack
  code is introduced. Evidence: workspace typecheck, Biome lint and seven
  pack-loader regression tests pass. Next: integrate the branch and continue
  the remaining production-evidence audit (real KMS/WORM/PITR/IdP and external
  security validation).

- **Started the evidence-integrity macro task.** The server coverage projection
  now verifies every run's hash-chained audit events before deriving risk
  coverage and returns a bounded `AUDIT_CHAIN_INVALID` error on tampering. The
  first server contract is green locally; full workspace gates and hosted
  PostgreSQL/HTTP evidence remain required.

- **Hardened the DR evidence CLI after automated review.** Restore evidence now
  must reconcile `observed_rto_minutes` with the raw `started_at` and
  `completed_at` timestamps, bundled-entrypoint tests cover both DR commands
  and missing `--public-key` values, and CLI failures use the shared
  redaction-safe error formatter. Targeted compliance/kit tests are green;
  full repository gates are the next proof before pushing the PR update.

- **Closed the DR envelope ambiguity found in the second review pass.** The
  inventory parser now reserves top-level `inventory`/`signature` keys so an
  unsigned document cannot be confused with a signed envelope; compliance and
  CLI regression tests cover the boundary. The refreshed hosted run is still
  required before merge.

- **Added DR evidence CLI gates.** `aqa dr inventory` now validates and hashes a
  machine-readable backup inventory, verifies signed inventory envelopes only
  with an explicit Ed25519 public key, and `aqa dr restore` validates a restore
  drill against the inventory's backup identity, artifact manifest digest,
  RPO/RTO objectives and required security checks. The DR runbook now points to
  these gates. Evidence: `@aqa/kit` suite **151 pass / 0 fail / 2 platform
  skips**, repository typecheck/lint/build, installed CJS `aqa dr` smoke and
  workspace tests **711 pass / 0 fail** pass locally. Hosted CI is still
  required before merge; real PostgreSQL PITR, object-store restore, KMS and
  WORM controls remain deployment evidence.

- **Closed the PostgreSQL trajectory migration race in code.** Hosted CI showed
  that two trajectory-store instances could concurrently create the same
  PostgreSQL relation, despite `IF NOT EXISTS`, producing a `pg_type` duplicate
  error. Production clients now bootstrap inside one transaction protected by
  `pg_advisory_xact_lock`; injected clients without `begin()` are rejected
  unless they explicitly opt into the unsafe test-only migration path. Local
  runner evidence is **67 pass / 0 fail**, typecheck and Biome are green. A
  post-fix hosted PostgreSQL run is required before this race boundary is
  considered verified.

- **Added live PostgreSQL trajectory evidence to CI.** The runner package test
  script now includes the trajectory suite, and the PostgreSQL integration job
  runs a two-instance trajectory contract with retry, immutable-conflict and
  read-back assertions when `AQA_TEST_POSTGRES_DSN` is provided. The hosted
  run for `ce11adf` is evidence for the live trajectory contract before the
  transaction-scoped migration fix; the current PR must be validated by a newer
  hosted run before the race fix is closed. Backup/PITR/restore and WORM
  operations remain deployment evidence.

- **Added cross-replica PostgreSQL trajectory persistence.**
  `PostgresAgentTrajectoryStore` uses an immutable `(run_id, scenario_id)`
  primary key, atomic conflict-safe insert, bounded envelopes and digest plus
  invariant verification on read. Evidence: runner suite **65 pass / 0 fail**
  including idempotent retry, conflict, tamper, traversal and injected-SQL
  cases; live PostgreSQL backup/PITR/restore and WORM evidence remain open.
  ADR-196 records the storage boundary.

- **Added authenticated MCP HTTP transport.** `McpHttpTransport` now mounts
  the bounded JSON request/response MCP surface through the Fetch API: every
  request is authenticated, sessions are principal-bound and capped, bodies
  are byte-limited, protocol versions are checked, idle sessions expire and
  `DELETE` terminates a session. Evidence: MCP tests **8 pass / 0 fail** and
  server suite **140 pass / 0 fail**, including auth binding, body limits,
  expiry and termination. SSE
  push, sticky/shared sessions and deployed TLS/IdP evidence remain open.
  ADR-195 records the transport boundary.

- **Added durable immutable trajectory artifacts.** `AgentTrajectoryStore`
  validates before write, bounds UTF-8 size, writes through a temporary file
  and rename, refuses replacement under the same run/scenario identity, and
  rechecks digest plus trajectory invariants on read. Evidence: runner
  trajectory suite **9 tests pass / 0 fail** (including tamper, traversal and
  size cases); remote WORM/Object-Lock, backup/restore and S3 deployment
  evidence remain open. ADR-194 records the storage boundary.

- **Added semantic agent evaluation and calibration primitives.**
  `evaluateAgentTrials()` now requires bounded multi-judge/multi-trial
  evidence, distinct models when configured, and returns `inconclusive` below
  the agreement floor. `calibrateAgentJudges()` reports Brier score and ECE
  over a gold corpus without storing rationale text. Evidence: runner suite
  **57 pass / 0 fail** after the new contract tests; live provider quality,
  prompt pinning and human gold-set governance remain open. ADR-193 records
  the boundary.

- **Bound MCP to the real queue/store.** `createMcpRunPort(ctx)` now uses the
  authoritative `RunnerQueue` and `StoreProvider`: plan is read-only, start
  validates the tenant profile and uses scoped idempotency, status/cancel are
  tenant-fenced, and evidence returns bounded store-derived metadata. A real
  MemoryStore + RunnerQueue MCP journey passes alongside the 136-test server
  suite; PostgreSQL and authenticated streamable-HTTP deployment evidence
  remain required.

- **Fixed the Node 22 CI compatibility regression in the MCP slice.** The
  first hosted matrix caught a TypeScript parameter-property unsupported by
  Node's strip-only loader; the server class now uses explicit fields. This
  is a real runtime-compatibility fix, not a CI suppression. The PR will be
  re-pushed and the full Bun/Node matrix rerun.

- **Added the bounded MCP control surface.** `AqaMcpServer` negotiates an
  explicitly supported protocol version and exposes only tenant-scoped plan,
  start, status, cancel and metadata-only evidence tools. Permission checks,
  principal-derived scope, bounded inputs and idempotent starts are enforced
  before the host port is called. Evidence: server MCP suite **4 pass / 0
  fail**, package build/typecheck/Biome green. Streamable HTTP authentication,
  real queue/provider binding and deployed MCP journey remain required.
  ADR-192 records the transport-neutral boundary.

- **Closed the trajectory verification loop.** `verifyAgentTrajectory()` now
  checks identity, contiguous sequence, SHA-256 digests, token reconciliation
  and (when supplied) one-to-one correspondence with agent hash-chain events.
  Evidence: trajectory verifier suite **4 pass / 0 fail** including tamper and
  event-mismatch cases. ADR-191 records the privacy-preserving replay boundary;
  signatures, durable remote attestation and semantic grading remain separate.

- **Added pinned opaque agent trajectory evidence.** `AgentTrajectoryRecorder`
  enforces contiguous step and token budgets, pins provider/model identity, and
  emits `llm_call`/`tool_call` audit events with SHA-256 digests and usage only.
  Evidence: trajectory + tool-guard tests **7 pass / 0 fail**; raw prompt/tool
  data is absent from snapshots and events. ADR-190 records the boundary;
  provider semantic evaluation, durable storage and MCP protocol evidence
  remain open integrations.

- **Added the provider-neutral agent tool guard.** `AgentToolGuard` enforces
  exact tool allowlists, call budgets, output byte limits and cooperative
  cancellation, while emitting `tool_call` audit events containing only
  digests and bounded metadata. Evidence: runner guard + regression suite
  **33 pass / 0 fail** with no raw secret in events. ADR-189 records the
  boundary; MCP/provider egress and model semantics remain deployment-scoped.

- **Opened the agent execution boundary.** `aqa run` now accepts
  `execution_mode: agent` only with an explicit host-owned `agentRunner`; the
  run fails closed before allocation when it is missing. Agent runs propagate
  agent actors to probe/oracle/finding evidence and mark findings with agent
  provenance. Evidence: runner + kit boundary suite **62 pass / 0 fail**,
  workspace typecheck/lint green. ADR-188 records that provider-backed
  trajectories, model pinning and MCP/tool policy remain separate integrations.

- **Added pre-execution scenario contract validation.** `Scenario` now rejects
  unsupported HTTP probe fields, malformed named auth references, non-string
  headers, non-numeric HTTP status expectations, and incomplete JSONPath
  response comparators, including cleanup probes. Evidence: schemas typecheck
  and targeted validator/AJV suite **69 pass / 0 fail**. ADR-187 records the
  boundary; full repository gates and hosted CI are still required before merge.

- **Connected authenticated HTTP probes to the real `aqa run` boundary.**
  `RunOptions.httpSecrets` and the explicit `AQA_HTTP_SECRET_<NAME>` host
  mapping now feed named auth references without exposing values to packs,
  events or findings. A complete local journey (`aqa run` → HTTP server →
  Authorization header → audit artifacts) passes; kit run-cmd contracts are
  **32 pass / 0 fail**. ADR-186 records secret-manager/CI ownership and keeps
  provider-specific token rotation as separate live evidence.

- **Closed two runner false-green paths.** HTTP probes now reject unknown
  fields and resolve `auth: "${NAME}"` only from host-injected secrets;
  missing secrets are execution errors, never anonymous requests. The
  `response_contains` oracle now compares bounded JSONPath values with literal
  or prior-probe references such as `@probe-1.body.id`, instead of silently
  ignoring `jsonpath`/`equals`. Runner regression suite is **37 pass / 0
  fail** including missing-secret, secret-injection and cross-step equality
  cases. ADR-185 records the boundary; provider-specific token rotation
  remains a live integration journey.

- **Added the executable dispute/chargeback journey.** `verifyDisputeJourney()`
  now requires provider-observed non-empty chargeback evidence, validates
  exact order/payment linkage, tenant/customer ownership, duplicate IDs,
  amount/currency bounds and opened-dispute evidence deadlines. Added the HTTP
  observer and explicit reference seeding path. Commerce contracts are **36
  pass / 0 fail** with explicit PostgreSQL skips. ADR-184 records that
  inducing a network dispute and proving representment remains live provider
  sandbox evidence.

- **Added the executable subscription dunning journey.** Versioned dunning
  attempts now expose contiguous retry history, amount/currency linkage and
  scheduling metadata. `verifyDunningJourney()` requires a provider-observed
  failed renewal, validates subscription ownership and minimum attempts, and
  the HTTP/reference adapters implement the observation boundary. Commerce
  contracts are **34 pass / 0 fail** with explicit PostgreSQL skips. ADR-183
  records that inducing a failure and proving provider collection still needs
  a billing sandbox/staging integration.

- **Added the executable ecommerce loyalty journey.** `verifyLoyaltyJourney()`
  now performs checkout, requires a checkout-linked earn event, validates
  tenant/customer ownership and reconciles the complete observed ledger.
  Added the HTTP observer path, reference merchant evidence and aggregate-suite
  support. Commerce contracts are **32 pass / 0 fail** with one explicit
  PostgreSQL skip. ADR-182 documents the provider-neutral boundary; real
  loyalty vendors, expiration/promotions and durable atomicity remain live
  integration evidence.

- **Added the shared LLM transport boundary.** Every live provider adapter now
  fails closed on non-HTTPS endpoints, endpoint credentials/query/fragment
  data, literal private/local/metadata destinations and optional host
  allow-list violations. Local/private models require explicit
  `allowPrivateNetwork: true`; added 20 adapter tests total and ADR-181.
  Evidence: adapter build/typecheck, **20 passed / 0 failed**, Biome and diff
  checks. DNS-aware egress enforcement remains deployment evidence.

- **Added executable subscription coverage.** `verifySubscriptionJourney()`
  now checks idempotent create retry, plan/amount/interval, period ordering,
  tenant/customer ownership and authoritative read-after-write observation.
  Commerce contracts remain **30 pass / 0 fail**; billing provider, dunning,
  invoices, proration and tax integrations remain live evidence.

- **Added executable post-purchase/RMA coverage.** `verifyPostPurchaseJourney()`
  now requires fulfillment observation and validates tracking/order quantity
  invariants; it can also create and retry a typed return request with strict
  order/currency bounds. Commerce contracts remain **30 pass / 0 fail**;
  carrier/WMS/refund-on-return integrations remain external evidence.

- **Added executable settlement reconciliation.** Commerce adapters can expose
  `settlement_observer`; `verifySettlementJourney()` now binds checkout
  payment identity to parsed refunds/chargebacks and applies the net-total
  invariant. The aggregate suite can include the check; the reference contract
  remains **30 pass / 0 fail** locally. Acquirer/provider payout and live
  accounting evidence remain external.

- **Added the paid-order cancellation journey.** Commerce adapters can now
  expose an optional cancellation mutation; `verifyCancellationJourney()`
  checks customer-scoped checkout, idempotent retry, accepted decision and
  compensating refund linkage. The aggregate suite can include it without
  treating unsupported providers as green. Commerce contracts remain **30
  pass / 0 fail** locally; provider void/refund, fulfillment release and
  durable external idempotency remain live evidence.

- **Added the provider-neutral commerce journey suite gate.**
  `verifyCommerceJourneySuite()` now executes required checkout/refund flows
  and optional tax/shipping/webhook flows, prefixes their evidence, and keeps
  `unsupported` distinct from `pass`. The reference contract now proves the
  aggregate gate with **30 commerce tests passed / 0 failed**. Real payment,
  tax, shipping, fulfillment and dispute providers remain external journey
  evidence.

- **Closed the coverage evidence integrity gap.** `aqa risk coverage` now
  verifies each persisted `events.jsonl` hash chain before accepting
  `scenario_finished` observations. Tampered but schema-valid events fail
  closed with no coverage report; the regression suite is **145 pass / 0 fail
  / 2 platform skips** for the kit. Independent WORM/checkpoint publication
  and provider semantics remain separate evidence layers.

- **Closed the local installable-artifact evidence gap.** Added a complete
  `npm pack` journey that prepares the publish manifest, rejects leaked
  `@aqa/*` dependencies, extracts the tarball in isolation, and runs the
  installed CLI through `--version`, `--help`, `init` and `validate`. CI now
  runs it after the production build. Evidence: local journey passed on
  Windows; hosted registry publication, fresh-machine network installation
  and real provider journeys remain separate gates.

- **Connected risk coverage to the operator CLI.** Added `aqa risk coverage`
  to load RiskMap/pack scenarios and schema-validated `scenario_finished` run
  events, then report covered/partial/gap/stale status. Invalid evidence fails
  with exit 1; valid incomplete coverage fails with exit 2, so zero findings
  cannot create a false green. Event-chain verification and real provider/
  cluster semantics remain separate gates.

- **Aligned air-gap image tags with the Helm release.** The bundle script now
  derives server/runner image tags from `deploy/helm/Chart.yaml` `appVersion`
  and fails closed when that value is absent, removing the previous `0.6.0`
  versus chart `1.1.0` drift. Shell syntax and Helm render CI remain the
  repository evidence; registry publication and a real offline cluster remain
  operational evidence.

- **Aligned finding confidence with declared oracle weights.** Runner findings
  now use a weighted mean of oracle agreement instead of an unweighted average;
  severity remains derived from the resolved risk. Evidence: runner build,
  typecheck, targeted tests including the 1:3 weighting regression, Biome and
  diff-check pass. Statistical calibration and project-specific weight quality
  remain separate evidence.

- **Fixed single-target agent bootstrap consistency.** Claude, Gemini and
  Copilot adapters now emit the canonical `AGENTS.md` they already reference,
  matching Codex behavior. Adapter tests cover every target's bootstrap and
  interoperable `SKILL.md` layout. Host-version discovery and execution remain
  separate operational evidence.

- **Added bounded source reachability to risk discovery.** The source method
  now filters JS/TS signals through a non-executing relative-import graph,
  preserves dependency manifests, and emits explicit
  `reachability:bounded-import-graph` evidence. An unreachable-marker
  regression test prevents dead source files from becoming risks. Aliases,
  dynamic imports, generated code and non-JS/TS graphs remain intentionally
  outside this heuristic's proof boundary.

- **Added human-gated AI risk hypotheses.** `@aqa/generator` now exposes
  `proposeRisks` and a separate `RiskReviewQueue`: model candidates are
  DLP-redacted, schema-validated, provenance-hashed and kept pending until a
  named reviewer approves them; no active `RiskMap` is mutated by generation.
  Evidence: generator tests cover valid/invalid output, redaction, provenance,
  approval and anonymous-review rejection. Remote identity, LLM quality and
  production persistence remain open evidence layers.

- **Added bounded source-aware risk discovery.** `aqa risk discover
  --method source` scans up to 200 safe, bounded source/manifest files and
  emits only deterministic risks whose authentication, interpreter, outbound
  request or secret signals are observed. Each result carries source-aware and
  bounded evidence-path tags; no source leaves the project. Evidence:
  risk-discovery tests **6 passed / 0 failed**, kit build/bundle/typecheck/
  Biome/diff-check pass. This is an explainable heuristic baseline, not an
  autonomous LLM/security review.

- **Source-aware risk discovery merged to `main`.** PR #70 was squash-merged
  as `833d949` after all 10 hosted CI jobs passed, including PostgreSQL 16,
  Node 22, CLI smoke and Playwright admin UI. The deterministic heuristic is
  now released; AST/dependency reachability, LLM-assisted hypotheses and
  human/security review remain separate evidence layers.

- **Added W3C trace propagation across HTTP probe boundaries.**
  `makeHttpProbeRunner` now accepts an explicit trusted trace context and
  propagates `traceparent` to the target, overriding any scenario-supplied
  value. Invalid/untrusted scenario metadata cannot forge the run trace.
  Evidence: runner tests **25 passed / 0 failed**, build/typecheck/Biome/
  diff-check pass. Collector deployment and cross-process trace export remain
  operational evidence.

- **W3C trace propagation merged to `main`.** PR #69 was squash-merged as
  `c5ba579` after all 10 hosted CI jobs passed, including PostgreSQL 16,
  Node 22, CLI smoke and Playwright admin UI. Trusted trace correlation now
  crosses the HTTP probe boundary; Collector/reverse-proxy preservation
  remains deployment evidence.

- **Added restore-drill evidence validation.** `@aqa/compliance` now checks a
  drill against the signed backup inventory: source and restored manifest
  identity, monotonic timestamps, observed RPO/RTO against approved objectives,
  tenant isolation, audit-chain, queue-fencing and secret-redaction controls.
  Drift, objective violations and incomplete controls fail closed. Evidence:
  compliance tests **15 passed / 0 failed**, build/typecheck/Biome/diff-check
  pass. This validates submitted evidence; it does not execute a cluster
  restore.

- **Restore-drill evidence merged to `main`.** PR #68 was squash-merged as
  `d7d1298` after all 10 hosted CI jobs passed, including PostgreSQL 16,
  Node 22, CLI smoke and Playwright admin UI. The evidence validator is now
  released; actual PITR/object restore and measured production RTO/RPO remain
  operational evidence.

- **Hardened AI scenario generation provenance and fallback validity.** Review
  queue items now retain provider/model/version plus SHA-256 hashes for the
  invariant, prompt and raw model response, while raw prompt/response text is
  not persisted. Also fixed a real generator bug where minimal valid JSON
  drafts were discarded because fallback `id`/`title` fields were absent.
  Evidence: generator tests **6 passed / 0 failed**, build/typecheck/Biome/
  diff-check pass. Human approval remains mandatory before activation.

- **AI generation provenance merged to `main`.** PR #67 was squash-merged as
  `0df8663` after all 10 hosted CI jobs passed, including PostgreSQL 16,
  Node 22, CLI smoke and Playwright admin UI. The generated-draft audit trail
  and fallback regression are now released; model trust and human review remain
  explicit governance boundaries.

- **Added Ed25519 signatures for DR inventory evidence.** Backup inventories
  can now be signed over their canonical representation and verified against an
  explicitly supplied trusted public key; missing trust roots and tampered
  payloads fail closed. Evidence: compliance tests **13 passed / 0 failed**,
  build/typecheck/Biome/diff-check pass. Key custody/rotation remains an
  external KMS/Vault responsibility.

- **DR inventory signatures merged to `main`.** PR #66 was squash-merged as
  `4b38898` after all 10 hosted CI jobs passed, including PostgreSQL 16,
  Node 22, CLI smoke and Playwright admin UI. The code now verifies signed
  recovery evidence; key custody, rotation and live restore remain external
  operational evidence.

- **Added a machine-validatable DR backup inventory contract.**
  `@aqa/compliance` now parses and canonicalizes a redacted recovery manifest
  containing PITR target/LSN, schema version, artifact manifest digest/object
  count, image digest, operator drill ID and RPO/RTO objectives. Invalid
  identifiers, digests, timestamps and zero objectives fail closed. Evidence:
  compliance tests **12 passed / 0 failed**, build/typecheck/Biome/diff-check
  pass. This does not claim a live backup or restore drill.

- **DR inventory contract merged to `main`.** PR #65 was squash-merged as
  `0c42570` after all 10 hosted CI jobs passed, including PostgreSQL 16,
  Node 22, CLI smoke and Playwright admin UI. The manifest format is now part
  of the released code; WAL/KMS/Object Lock/restore execution remains
  infrastructure evidence.

- **Added provider-neutral commerce settlement reconciliation.** The commerce
  contract now validates that captured payment, successful refunds and lost
  chargebacks are linked to the same payment and exactly reconstruct the
  provider-reported net settlement. Unresolved chargebacks and non-successful
  refunds fail closed. Evidence: commerce contracts **29 passed / 0 failed**,
  build/typecheck/Biome/diff-check pass. Live PSP settlement remains external
  deployment evidence.

- **Settlement reconciliation merged to `main`.** PR #64 was squash-merged as
  `5b801d4` after all 10 hosted CI jobs passed, including PostgreSQL 16,
  Node 22, CLI smoke and Playwright admin UI. The implementation boundary is
  closed; live PSP/payout/fee/dispute reconciliation remains deployment
  evidence.

- **Commerce refund integrity hardened.** Payment validation now parses the
  runtime snapshot, requires `partially_refunded` to carry a strictly positive
  partial amount, requires all refund states to reconcile with the captured
  amount, and rejects a successful refund larger than the observed cumulative
  refunded amount. Regression coverage: commerce contracts **28 passed / 0
  failed**; PostgreSQL provider coverage remains an external-DSN/CI journey.
  Next: run the complete hosted matrix on the PR.

- **Commerce refund integrity merged to `main`.** PR #63 was squash-merged as
  `2c87ca5` after the complete hosted matrix passed: 10/10 jobs green,
  including PostgreSQL 16, Node 22, OCI sandbox, CLI smoke and Playwright
  admin UI. This closes the implementation slice; live payment settlement and
  provider reconciliation remain deployment evidence.

- **Budget kill-switch API merged to `main`.** PR #62 was squash-merged as
  `b81cdbc` after the complete GitHub CI matrix passed: 10/10 jobs green,
  including Node 22, PostgreSQL 16, OCI sandbox, CLI smoke and Playwright
  admin UI. Copilot review was intentionally waived per user instruction.
  The next evidence gap is a controlled deployed-operator exercise against a
  real durable budget store.

- **Exposed the durable budget kill-switch through the admin API.** Added
  tenant-derived `GET/POST /api/cost/halt` routes, an admin-only `cost:edit`
  permission, fail-closed `503` behavior when the durable controller is absent,
  and `AQA_BUDGET_DSN` wiring through `aqa admin` and Helm. The request can
  never choose another tenant's budget key. ADR-159 records the boundary.
- Evidence: server suite **132 passed / 0 failed**, auth/server/kit typechecks
  pass, and Helm CI asserts the production DSN mapping. A deployed operator
  incident exercise remains operational evidence.

- **Promotion redemption slice merged to `main`.** PR #61 was squash-merged as
  `4feefb7` after the full CI matrix passed, including the PostgreSQL 16
  two-client redemption race and Playwright/CLI acceptance jobs. This closes
  the implementation slice; real merchant promotion settlement and financial
  reconciliation remain provider/deployment evidence.

- **Added atomic ecommerce promotion redemption.** `PromotionRedemptionLedger`
  now models `claimed`, `duplicate`, `conflict` and `exhausted` outcomes. The
  PostgreSQL implementation serializes each promotion code, enforces the hard
  redemption cap across replicas and preserves idempotent retry semantics;
  ADR-158 documents the provider-neutral boundary.
- Evidence: commerce typecheck and **29 tests passed** locally; a two-client
  PostgreSQL race is wired into the CI persistence contract. Provider settlement
  and financial reconciliation remain deployment evidence.

- **Enterprise safety tranche merged to `main`.** PR #60 was squash-merged as
  `4cdc3af` after the complete hosted CI matrix passed: Meta, Helm rendering,
  typecheck/lint, Bun and Node 22 tests, build plus CycloneDX SBOM, PostgreSQL
  16 persistence contracts, OCI sandbox, CLI smoke and Playwright admin E2E.
  The PostgreSQL job included concurrent migration, durable idempotency response
  decoding, queue priority and the cross-client budget kill-switch contract.
- **Verification boundary:** this proves the repository's automated acceptance
  matrix, not a live merchant/payment provider, a real IdP ceremony, a restore
  drill or a production cluster upgrade. Those remain deployment evidence and
  are deliberately not marked complete.

- **Added a durable distributed LLM kill-switch.** The optional
  `BudgetHaltController` exposes bounded per-key `halt()`/`getHaltReason()`
  operations without breaking third-party `BudgetLedger` implementations. PostgreSQL persists the
  stop in `aqa_llm_budget_halts` and rejects later reservations across worker
  processes; the memory implementation remains an explicit local fallback.
  ADR-157 records the irreversible operator boundary.
- Evidence: cost typecheck and **14 tests passed**. A live PostgreSQL
  multi-client halt/admission journey is now wired into the PostgreSQL CI
  contract; the hosted run is required before claiming HA production evidence.

- **Fixed PostgreSQL idempotency response decoding.** The live multi-replica
  contract exposed that PostgreSQL's JSONB driver result can arrive as a JSON
  string, so a coalesced retry returned serialized body/headers instead of the
  same `ApiResponse` shape as the original request. The durable adapter now
  decodes JSONB values before returning cached responses.
- Evidence: server typecheck and suite **131 passed / 0 failed** locally; CI
  run `35229505062` had all other gates green and isolated the PostgreSQL
  failure to this contract. A new hosted run is required for closure.

- **Fixed a real PostgreSQL bootstrap race.** Concurrent `PostgresEventBus`
  replicas could both pass `CREATE TABLE IF NOT EXISTS` but collide while
  PostgreSQL created the implicit identity sequence, failing CI with
  `duplicate key ... aqa_live_events_sequence_seq`. The schema and index DDL
  now run under a stable transaction-scoped advisory lock (ADR-147).
- Evidence: repository typecheck passed; the failing CI job was isolated to
  the concurrent PostgreSQL EventBus contract, while the other PostgreSQL
  contracts passed. The corrected branch still needs a fresh CI run to prove
  the fix in PostgreSQL 16.

- **Closed an HTTP dispatcher regression.** The bundled admin server now parses
  `PATCH` request bodies and advertises `PATCH`, `Idempotency-Key` and `If-Match`
  in CORS preflight responses. This restores the real HTTP path for SCIM patch
  and conditional/idempotent browser mutations; the route handlers alone had
  not exposed the adapter bug.

- **Bounded webhook response reads before allocation.** `HttpWebhookTransport`
  now consumes response streams incrementally and cancels as soon as the byte
  cap is exceeded, covering responses that omit `Content-Length`; a regression
  test proves the rejection path without contacting a provider.

- **Added a concrete secret-manager integration.** `VaultSecretResolver` now
  resolves Vault KV-v2 values lazily with an injected token provider, HTTPS
  endpoint enforcement, bounded timeout, safe secret-reference segments and
  generic provider errors (ADR-148). The queue persists only `secret_ref`; no
  real credentials or external calls are used in tests.

- **Corrected a stale architecture claim.** `docs/architecture/reference.md`
  no longer presents the historical v1.x task list as proof of GA or production
  readiness; it now points to the active v2.0 evidence matrix and distinguishes
  implemented, integrated and production-verified capabilities.

- **Unified API mutation idempotency.** Every non-GET route now accepts a
  validated `Idempotency-Key` through one route boundary. The key is scoped to
  tenant/route, bound to params/body/conditional version, concurrent retries
  share the in-flight response, and mismatched reuse returns `409` without
  invoking the handler again. `MemoryApiIdempotencyStore` is explicitly a
  single-process fallback; production multi-replica deployments must inject a
  shared durable implementation. The contract is covered on an organization
  mutation, not only on the existing runner queue path (ADR-149).
  `PostgresApiIdempotencyStore` now provides the shared multi-replica claim and
  response store; the PostgreSQL CI contract exercises two clients competing
  for one mutation key. The local memory store remains an explicit fallback.

- **Added connection-aware webhook egress.** `NodePinnedHttpsWebhookTransport`
  resolves DNS once, rejects every private/local/multicast answer before
  connecting, pins the selected IP in the TLS socket while retaining hostname
  SNI/Host, disables redirect behavior by construction and bounds response
  bytes. A regression test proves mixed public/private DNS answers are denied;
  non-Node runtimes must use an equivalent egress proxy policy.

- **Closed a cancellation false-green path.** `runScenario()` now stops
  remaining steps when its signal is aborted, always executes declared cleanup,
  and returns `blocked` with failed execution instead of passing an empty-oracle
  scenario. A regression proves the remaining step is skipped and cleanup is
  still attempted.

- **Persisted a canonical run terminal state.** `run_finished.payload.run_state`
  now records the hash-protected terminal state at finalization. The shared
  schema derivation prefers this explicit state for new events and retains the
  counter-based fallback for legacy runs, so report/admin/other consumers share
  one authoritative state instead of independently guessing it. A CLI negative
  journey asserts a missing driver persists `run_state=failed` (ADR-151).

- **Bounded cooperative probe execution.** Every probe now receives a derived
  abort signal with its declared `timeout_ms`; the runner converts a timeout or
  caller cancellation into an execution failure even if a cooperative driver
  returns a nominal response after abort. Runner tests now cover the timeout
  contract (**47/47**). Hard-killing an uncooperative third-party process still
  belongs to the OCI/container isolation boundary and is not claimed here.

- **Fixed the second PostgreSQL EventBus CI defect.** After the bootstrap race
  fix, the live replay query failed on PostgreSQL 16 when an optional project
  scope was absent because an untyped `NULL` parameter could not be inferred.
  The nullable parameter now has an explicit `text` cast. A fresh CI run is
  required for final PostgreSQL evidence.

- **Commerce assurance pack.** Added the opt-in `pack-commerce-core`, selected
  only for ecommerce/commerce/shop/storefront project tags. It defines five
  release-gate journeys (checkout idempotency, inventory oversell, tax/shipping
  money reconciliation, refund idempotency and webhook replay) plus five risks
  and invariants; it is provider-neutral and treats missing authoritative
  observations as incomplete rather than passing.
- Evidence: all five scenarios and the risk map parse through the real Zod
  schemas; bundled-pack integrity test **13/13** and kit bundle now contains
  **6 packs**. ADR-130 records the opt-in boundary. Real merchant/provider
  journeys remain deployment evidence.

- **Replay artifact truthfulness.** Playwright replay files now generate
  executable code for the runner's structured `url`/`actions` contract, and
  SQL replay files now contain a read-only transaction with `PREPARE/EXECUTE`
  and safely rendered parameters. External script-only browser probes are
  explicitly marked as requiring the original spec instead of being presented
  as a runnable reproduction. Reporter suite **9/9** passes.
- Evidence: reporter typecheck, replay tests and Biome pass. Provider-specific
  browser fixtures and database credentials remain external deployment inputs;
  ADR-131 records the artifact boundary.

- **Conditional admin edits.** Profile, risk and scenario detail reads now
  emit strong content ETags; their PUT boundaries honor `If-Match` and reject
  stale writes with `412 PRECONDITION_FAILED` before persistence. Profile,
  risk and scenario editors now capture the tag on open and send it on PUT;
  successful saves refresh the tag. A server regression proves the newer value
  survives a stale client update, and a Chromium journey proves the risk editor
  sends the captured tag.
- Evidence: server suite **123/123**, admin typecheck/build, targeted Risk Edit
  browser suite **5/5**, server/kit typechecks and Biome pass; ADR-129 records
  the backward-compatible migration boundary. A visible conflict-resolution
  flow now reloads the authoritative resource for profile, risk and scenario
  editors; targeted Risk Edit browser evidence is **6/6**.

- **Admin live Runs/Findings integration.** Runs and Findings now consume the
  tenant-scoped API and show an explicit `live API` marker; fixture fallback is
  retained only for an unavailable backend. The ecosystem fixture now declares
  its referenced risk/invariant, fixing a real scenario-parse failure.
- Evidence: rebuilt kit/admin and ran the complete ecosystem journey through a
  real SUT, CLI run, API server and Chromium: **2/2 Playwright tests passed**
  (live audit chain plus live Runs/Findings and detail navigation). The run
  fixture now carries its tenant org and live finding normalization tolerates
  valid sparse evidence without crashing the UI. Restart/Postgres/tenant
  switching journeys remain open. ADR-128 records the boundary.

- **Documentation supply-chain audit remediated.** The independent `docs-site`
  npm lockfile had five high and one moderate advisory (Hugging Face/ONNX,
  `sharp`, `adm-zip`, `protobufjs` and `linkify-it`) that the root Bun audit
  could not see. Upgraded the docs toolchain, regenerated the lockfile, and
  ignored its generated search index. Evidence: `npm ci --ignore-scripts`,
  `npm run check`, `npm run build`, and `npm audit --json` all pass; audit
  result is **0 vulnerabilities**. ADR-127 records the separate-gate rule.
- The historical PR review still records the pre-remediation advisory state;
  hosted CI/default-branch evidence must be refreshed after merge. The root
  audit is currently clean as well.

- **Report audit-chain verification.** `aqa report` now verifies every parsed
  event with `@aqa/compliance.verifyEventChain` before reconstructing state or
  writing Markdown/JSON output. Tampered payloads fail closed; fixtures now
  use production-compatible canonical SHA-256 sealing and include a negative
  regression. ADR-126 records the local-integrity boundary.
- Evidence: focused report suite **138 passed / 2 platform skips** after the
  kit build. Full workspace gates are next; independent checkpoint/WORM
  completeness and live deployment evidence remain open.

- **HTTP error disclosure hardening.** Added shared `safeErrorMessage()` in
  `@aqa/observability` and wired it into server and bundled-admin failure
  responses. DSNs, bearer tokens, JWTs, cloud keys, PAN/IBAN values, secret
  assignments and control characters are redacted or bounded before HTTP
  exposure; ADR-123 and the threat model record the residual DLP gap.
- Evidence: observability test **13/13 passed**, server and kit typechecks
  passed, and Biome lint passed. Full workspace regression is still required
  after this increment; PostgreSQL/browser/provider live journeys remain
  explicit deployment evidence gaps.

- **Centralized evidence DLP and PAN false-positive fix.** Moved text/JSON
  redaction into `@aqa/observability` and wired artifacts, findings, audit
  events, SQL, shell and browser evidence to the same policy. PAN masking now
  requires a valid Luhn checksum, preventing dates and run IDs from being
  rewritten; ADR-124 records the binary/provider-specific residual gap.
- Evidence: targeted observability **13/13**, artifacts **6/6**, commerce
  **23/23**, and kit **137 passed / 2 platform skips**. A full workspace test,
  typecheck and build gate is the next verification step.

- **Configurable DLP coverage expanded.** The shared policy now redacts IPv4,
  contextual high-entropy secret assignments and operator-supplied regex
  patterns in addition to AWS/JWT/email/Luhn-PAN/IBAN values. Regression
  coverage explicitly proves timestamps and run IDs remain unchanged.
- Evidence: observability **14/14** and repository lint passed. Binary
  screenshots/PDFs, IPv6/provider-specific formats and enterprise secret
  classifiers remain deployment/provider-specific gaps.

- **Replay identity hardening.** `verifyScenario()` now anchors all replay
  successes to the persisted original failure fingerprint when one is
  supplied, instead of accepting any later finding. Added a negative test for
  a mismatched original fingerprint and ADR-125; unsupported/no-finding
  attempts remain non-reproductions.
- Evidence: runner **45/45 tests**, runner typecheck and repository lint passed.
  Full workspace regression is required before the increment is complete.

- **Runner capability preflight added.** `runScenario()` can now receive the
  configured driver's supported probe kinds and fails before executing steps or
  cleanup when a browser/SQL/shell/LLM/custom capability is absent. The gap is
  recorded as failed execution evidence and cannot emit a finding; concrete
  drivers and live journeys remain open.

- The kit orchestration boundary now forwards `supportedProbeKinds` to every
  scenario, so integrations cannot accidentally configure preflight on the
  runner and then lose it at `aqa run`.

- **CLI audit publication wired.** A dedicated `AQA_AUDIT_CHECKPOINT_S3_*`
  configuration now creates a separate compliance-retained S3 store for the
  final checkpoint. Partial configuration and non-`COMPLIANCE` retention fail
  before execution; credentials remain on the AWS provider chain.

- **Controlled shell driver added.** The runner now has an explicit
  `makeShellProbeRunner()` with `shell:false`, executable allowlist, argv-only
  inputs, bounded/redacted output and timeout termination. It is deliberately
  not a sandbox; OCI/non-privileged deployment and explicit capability wiring
  remain required before production use.

- **Read-only SQL driver added.** `makeSqlProbeRunner()` now exposes an
  injected database observer for ecommerce invariants with parameter binding,
  lexical mutation/multi-statement rejection, row limits and redacted rows.
  It is not a DB permission boundary; a production adapter still needs a
  dedicated read-only role, timeout, tenant views and live provider evidence.

- **Canonical scenario outcomes added.** Runner results now distinguish
  `pass`, `fail`, `error`, `blocked` and reserved `not_run`, separating SUT
  assertion failures from provider/driver gaps. CLI/report persistence still
  needs to expose the field end-to-end for complete outcome coverage.

- **Outcome persistence wired into the audit chain.** Kit runs now emit
  `scenario_started`/`scenario_finished` and include `scenario_outcomes` in
  `run_finished`, preserving `blocked` versus `error` in canonical evidence.
  Admin/report rendering remains the next integration gap.

- **Outcome reporting completed.** Reporter JSON now exposes validated
  `scenario_outcomes`, Markdown renders each scenario state, and `aqa report`
  reads the values from the terminal audit event with fail-closed validation.
  Admin live rendering and persisted server projections remain separate UI/API
  integration work.

- **Real Playwright driver added.** Runner now supports a persistent browser
  context through structured, origin-scoped actions with bounded/redacted text
  evidence and explicit close lifecycle. The fake-browser contract test is
  green; installed Chromium, live checkout journey and SUT/provider
  reconciliation remain required evidence.

- **Driver lifecycle wired into kit orchestration.** `aqa run` now invokes an
  optional probe-runner `close()` before publishing replay/audit artifacts and
  turns shutdown failures into run errors. The Playwright journey has a real
  close assertion; hard process cancellation remains worker/sandbox work.

- **Real Postgres SQL adapter added.** The runner now provides a concrete
  Postgres implementation with read-only transactions, local statement timeout,
  bounded rows and lifecycle close. CI PostgreSQL now runs its contract test;
  local no-DSN runs are explicitly skipped. Merchant schema/RLS/provider
  reconciliation remains open.

- **Live HTTP commerce adapter added.** `@aqa/commerce` now maps typed carts,
  checkout, payments, refunds, tax, shipping and webhook observations to a
  configurable allowlisted HTTP merchant API. Responses are bounded and Zod
  parsed; tenant context and idempotency keys are explicit. A real merchant
  sandbox journey and provider-specific auth/webhooks remain deployment work.

- **Commerce transport journey verified.** A local HTTP server backed by the
  reference merchant now runs the full checkout journey through
  `HttpCommerceAdapter`, including inventory-before/after and idempotent retry.
  This proves the transport contract, not a third-party merchant sandbox.

- **S3 WORM verification strengthened.** Production retention mode now performs
  a `HeadObject` read-back after both content and metadata writes and fails
  closed when Object Lock is absent or shorter than requested. This closes the
  provider-silent-ignore false-green path; independent checkpoint publication,
  bucket/versioning/KMS and restore drills remain deployment evidence.

- **Independent checkpoint publication added.** `runRun()` now supports a
  separately injected audit checkpoint store, publishes the final checkpoint
  under `checkpoints/<run_id>.json`, and records its digest in the canonical
  manifest. The journey test uses two distinct file stores; production still
  needs a separately administered WORM/KMS/backup domain and restore drill.

- **CI SBOM provenance gate added.** The Build job now runs a pinned Anchore
  Syft action after the workspace build, emits and retains a CycloneDX JSON
  inventory, and validates that it is non-empty and structurally valid. The
  root `npm sbom` command was tested and rejected because this Bun monorepo has
  no root `package-lock.json` and npm sees workspace/link dependencies as
  incomplete; it was deliberately not promoted into CI. Hosted CI evidence is
  still required, and this does not yet prove image-level or published-pack
  provenance.

- **Durable SCIM rotation made atomic.** `ScimTokenStore` now has an optional
  atomic rotation contract; the PostgreSQL store serializes revoke-and-issue in
  one transaction and the manager uses it when available. Lightweight stores
  retain the documented fallback. Existing auth tests and typecheck remain the
  next local gate; two durable store instances must still prove the path in CI.

- **CI regressions fixed from complete-journey evidence.** The Bun 1.3.11 job
  was executing PostgreSQL contracts after `t.skip()` instead of stopping;
  absent-DSN contracts now emit an explicit visible skip and return. The CLI
  smoke harness now runs the live-target child asynchronously so its parent
  HTTP server can service the real request; local evidence is **537 Bun tests
  passed** and all **5 CLI smoke checks passed**. The hosted rerun is required
  to close the previous CI failure.

- **Audit completeness checkpoint contract added.** `@aqa/compliance` now
  creates and verifies a checkpoint binding one run’s contiguous sequence,
  event count, head hash and canonical event digest; optional Ed25519 signing
  adds operator-controlled authenticity. Compliance tests: **10/10**. This is
  `aqa run` now emits `canonical/checkpoint.json` and references it from the
  canonical manifest. The CLI can sign it through paired checkpoint-key
  environment variables and rejects partial configuration. It is not yet
  stored in a WORM/Object-Lock domain; that external retention boundary remains
  open.

- **S3 WORM configuration can now fail closed.** `aqa run` rejects
  `AQA_ARTIFACT_S3_REQUIRE_RETENTION=true` unless an ISO retain-until timestamp
  and `GOVERNANCE`/`COMPLIANCE` mode are both configured. This prevents a
  production-shaped deployment from silently using mutable S3 artifacts; the
  bucket’s actual versioning/Object Lock/KMS state still requires infrastructure
  evidence.

- **RFC 6238 TOTP verification boundary added.** `@aqa/auth` now exposes a
  bounded, fail-closed verifier with constant-time code comparison, Base32
  decoding, configurable period/digits/skew window and RFC vector coverage.
  This deliberately does not claim enrollment, secret persistence, recovery
  codes or WebAuthn; those remain separate security work. Evidence: auth
  suite **18 passed, 3 PostgreSQL-dependent skips, 0 failures**, lint and
  diff-check pass. The RFC vector caught and fixed an unsigned HMAC truncation
  issue and an incorrect test secret encoding.

- **SCIM abuse limiter wired.** Added a bounded tenant-scoped sliding-window
  limiter, applied before bearer authorization on every SCIM operation, with
  `429 scim_rate_limited` responses and a default admin-boot policy. Evidence:
  auth 19 passed/3 PostgreSQL skips, server typecheck and repository lint
  pass. The limiter is intentionally process-local; a shared Redis/Postgres
  implementation is required before multi-replica deployment.

- **Shared SCIM limiter added for HA.** `PostgresScimRateLimiter` now uses a
  serialized schema migration and a transaction-scoped advisory lock per
  tenant, making the fixed-window admission decision atomic across replicas.
  `aqa admin` accepts `scimRateLimitDsn` / `AQA_SCIM_RATE_LIMIT_DSN`, and Helm
  plus CI render assertions expose the DSN. Evidence: auth **19 passed, 4
  PostgreSQL-dependent skips**, server build/typecheck, workspace typecheck,
  lint and diff-check pass. The hosted PostgreSQL job must execute the new
  cross-instance contract before claiming live HA evidence.

- **OTLP runtime wiring shipped.** `aqa run` accepts `--otlp-endpoint` (or
  `AQA_OTLP_ENDPOINT`), maps redacted audit-event metadata to bounded spans,
  and drains the exporter before returning. Collector failures become a
  visible warning while the hash-chained audit remains authoritative. Evidence:
  the real run journey sends spans to a local HTTP Collector fixture and
  verifies delivery before process return; observability 12/12, kit 126
  passed/2 platform skips, typecheck and lint pass.

- **Durable webhook effect ledger added.** Commerce now exposes an explicit
  `applyWebhookEffectOnce` boundary plus in-memory and PostgreSQL ledgers. A
  unique logical effect key is claimed atomically; duplicate deliveries are
  skipped and a different event for the same effect fails closed. Evidence:
  commerce **17 passed, 1 PostgreSQL skip**, typecheck, lint and diff-check
  pass. Live provider settlement and reconciliation remain separate.

- **Trusted pack signature boundary added.** Pack manifests support an
  operator-managed `key_id` plus detached Ed25519 signature over the canonical
  unsigned digest. The server import boundary enforces the allowlist when
  configured, while legacy SHA-256 remains an integrity-only path. Evidence:
  pack-scanner 9/9 and server 111 pass/1 PostgreSQL skip; schemas regenerated,
  typecheck and lint pass. This is not yet keyless Sigstore/cosign bundle or
  certificate-chain verification.

- **Stripe-style webhook signature boundary added.** Commerce now verifies the
  raw request body, `t=` timestamp, one or more `v1=` HMAC signatures and a
  positive replay tolerance using constant-time comparison. Evidence:
  commerce **16/16**, typecheck, lint and diff-check pass. This is a provider
  verification primitive, not evidence of live Stripe/payment settlement or
  durable event idempotency.

- **Formal risk coverage measurement shipped.** `@aqa/methodology` now
  computes the M2 weighted score (invariant mapping 35%, oracle-backed
  scenarios 25%, deterministic replay 20%, 30-day pass rate 10%, flake health
  10%), validates impossible observations and emits `covered`/`partial`/`gap`/
  `stale` plus drift alerts. This is a pure aggregation boundary ready for
  store/API wiring; it does not invent missing run evidence.
- **Commerce webhook assurance expanded.** The adapter now supports optional
  signed-delivery observations and `verifyWebhookJourney()` validates exact
  order linkage, delivered state, signature validity and bounded retries. The
  reference merchant emits one deterministic `order.created` observation per
  idempotent checkout; real provider webhook ingress, signature keys and
  durable reconciliation remain explicitly open.
- **Commerce tax/shipping assurance expanded.** `@aqa/commerce` now defines
  versioned address, tax quote and shipping rate contracts plus
  `verifyTaxJourney()` / `verifyShippingJourney()`. The reference merchant
  exposes deterministic zero-tax/standard-shipping observations; validators
  reject currency mismatches, negative amounts and duplicate rates. Real tax,
  carrier and fulfillment integrations remain provider-specific and are not
  claimed by the reference implementation.
- **LLM registry truthfulness corrected.** The registry no longer contains a
  stale “live adapter not implemented” scaffold after native OpenAI-compatible,
  Anthropic, Google, Cohere and Bedrock adapters shipped; invalid runtime
  provider values now fail explicitly and the threat model reflects the real
  vLLM/Ollama boundary.
- **Server identifier hardening.** API job/event IDs now use Node
  `crypto.randomUUID()` instead of a hand-rolled `Math.random()` generator;
  this removes predictable identifiers from queue and notification boundaries.
- **Run enqueue idempotency and tenant boundary shipped.** `POST /api/runs`
  now requires org/project scope, embeds that scope in the job payload, binds
  `Idempotency-Key` to a canonical request fingerprint, returns the same job
  for identical retries and returns `409 IDEMPOTENCY_CONFLICT` for changed
  retries. Memory and PostgreSQL queue contracts cover the behavior; ADR-030
  documents retention as a remaining operational concern.
- **EventBus integrated into API/admin lifecycle.** `ApiContext` can now emit
  store-first `run.requested` and `finding.status_changed` notifications, and
  `aqa admin` can inject or construct `PostgresEventBus` from
  `AQA_EVENT_BUS_DSN`, closing it during shutdown. Notification failures remain
  fail-open by design; API tests prove the request event is emitted.
- **Helm production DSN wiring corrected.** The chart now maps an external or
  in-cluster PostgreSQL URL to the actual store, queue, shared OIDC-session and
  EventBus environment variables. CI renders a secret-ref production shape and
  asserts all four DSNs are present; the previous `AQA_POSTGRES_URL` alone did
  not activate the production adapters.
- **PostgreSQL event bus shipped.** `@aqa/server` now exposes `EventBus`,
  `MemoryEventBus` and `PostgresEventBus` with bounded envelopes, validated
  channels, cross-replica `LISTEN/NOTIFY`, idempotent unsubscribe and isolated
  subscriber errors. The live cross-client contract is wired into the
  PostgreSQL CI job; durability remains intentionally owned by the store and
  runner queue. ADR-029 records the transport boundary and reconnect gap.
- **OIDC store retention hardening.** The PostgreSQL session backend now indexes
  pending-state expiry and opportunistically removes expired PKCE/session rows
  on writes, preventing abandoned login attempts from producing unbounded
  table growth while preserving fail-closed expiry checks.
- **Post-OIDC acceptance gates green.** `bun run lint`, workspace typecheck,
  full Bun test suite (444 pass, 1 skip), workspace/docs build and
  `bun audit --json` all pass locally. The one skip is deliberate: the live
  `PostgresOidcSessionStore` contract requires `AQA_TEST_POSTGRES_DSN` and is
  executed by the PostgreSQL CI service job; no local database was available.
  Build warnings remain limited to the known CJS `import.meta` bundle warning
  and the admin chunk-size warning.
- **Shared OIDC session backend shipped.** `OidcSessionManager` now supports
  an async shared store, and `PostgresOidcSessionStore` provides advisory-locked
  tables, atomic one-time PKCE state consumption, durable session lookup and
  revocation. The admin HTTP path uses async authentication/logout and closes
  the backend on shutdown; two manager instances are covered by auth tests
  (9/9). The local map remains the explicit dev default. ADR-028 records the
  injection and production TLS/TTL responsibilities.
- **Air-gap deployment path completed.** The installer now has a real
  `install` flow: archive path/link safety checks, SHA-256 verification,
  optional required Cosign blob verification, Docker/Podman image loading and
  explicit Helm upgrade/install options. Terraform can optionally own a pinned
  Helm release while remaining cloud-provider neutral. CI runs `bash -n`; a
  live air-gap cluster remains deployment evidence, not a local claim.
  ADR-027 records the contract.
- **Provider-neutral observability foundation shipped.** New
  `@aqa/observability` provides W3C traceparent parsing/formatting, injectable
  spans, bounded Prometheus counters/gauges/histograms, label validation,
  cardinality limits and redacted structured logs. `EventChainWriter` exposes
  a non-blocking observer hook whose failures cannot invalidate persisted audit
  evidence. Tests: observability 5/5, runner 29/29. ADR-026 records the
  OTel/Prometheus integration boundary and remaining operator responsibilities.
- **Legacy configuration migration shipped.** Memory/Postgres stores now expose
  an explicit, fail-closed migration primitive for global packs, profiles,
  risks and scenarios. The admin-only
  `POST /api/admin/migrate-legacy-configuration` endpoint derives its target
  only from tenant scope headers, preflights conflicts and never overwrites a
  namespaced record. PostgreSQL performs the move in a serialized transaction;
  ADR-025 records the operator workflow. It intentionally does not migrate
  runs/findings or identity data.
- **Canonical run evidence publication shipped.** `aqa run` now publishes the
  byte-preserved `events.jsonl` and `findings.jsonl` through the configured
  `ArtifactStore`, plus a digest-bearing `canonical/manifest.json`. It uses
  `putBytes` so redaction cannot mutate already-redacted hash-chain evidence;
  any publication error fails the structured run result. Local metadata and
  byte equality are covered by the kit journey test. ADR-024 records the
  non-transactional partial-upload recovery responsibility.
- **Admin durable control-plane wiring shipped.** `aqa admin` now accepts an injected `StoreProvider` and selects `PostgresStore` from `AQA_STORE_DSN`, independently of the durable queue selected by `AQA_QUEUE_DSN`; both clients close during graceful shutdown and conflicting injection/DSN options fail before boot. The default remains `MemoryStore` for local development. ADR-021 and package docs record the deployment contract. PostgreSQL restart durability remains CI-authoritative when a real DSN is supplied.
- **Tenant legacy fallback closed.** Scoped Memory/Postgres reads and listings no longer fall back to globally keyed legacy packs, profiles, risks or scenarios; unscoped operations remain available for explicit migration/admin work. ADR-022 documents the fail-closed rule and a regression proves a global profile is invisible to a scoped tenant request. Migration/import tooling is still required to assign old records to a tenant.
- **Commerce Assurance adapter/journey slice shipped.** `@aqa/commerce` now defines a provider-neutral async `CommerceAdapter`, explicit capability preflight, and `verifyCheckoutJourney()` / `verifyRefundJourney()` with structured evidence. It validates money/order/payment/inventory snapshots, exact stock effects, bounded partial refunds and idempotent checkout/refund retries; missing capabilities return `unsupported`, malformed or inconsistent provider observations return `error`. The deterministic reference merchant exposes the same adapter contract. ADR-020 records the boundary. Commerce tests: 12/12. Real payment, tax, shipping, webhook and durable-provider integrations remain open and are not claimed.
- **Native Anthropic adapter shipped.** `@aqa/llm-adapters` now supports the Messages API with timeout, max-token bound, pre-request/response redaction, usage parsing, tool-schema forwarding and model provenance hash. Registry tests keep Google/Cohere/Bedrock on their native provider adapters; Anthropic suite: 10/10.
- **Native Google/Cohere adapters shipped.** `@aqa/llm-adapters` now maps Google Gemini `generateContent` and Cohere v2 `chat` contracts with provider-specific roles/content, tool schemas, bounded output, timeout, redacted transport/errors and usage parsing. Tests use injected transports and no credentials: provider adapter suite 2/2. ADR-023 records the boundary. Bedrock is now covered by its native SigV4 adapter; live AWS runtime evidence remains deployment-scoped.
- **Native Bedrock adapter shipped.** `@aqa/llm-adapters` now supports Bedrock Runtime Converse with AWS SigV4 signing, session-token forwarding, native content/tool mapping, bounded output, timeout, redaction, usage parsing and fail-closed credential validation. The signature contract is tested with deterministic injected transport and no live AWS credentials; IAM/region/private endpoint operations remain deployment responsibilities.
- **Dependency audit remediated.** `bun audit --json` is clean after upgrading Vite 8 + React plugin 6, esbuild 0.28, and pinning the vulnerable `fast-uri` range to 3.1.6 via the root override. Admin production build, kit typecheck/test/build and bundle execution remain green; the existing non-fatal CJS `import.meta` warnings are tracked separately.
- **Tenant-scoped configuration resources implemented.** Packs, profiles, risks and scenarios now accept `org/project` scope through `StoreProvider`; new records use deterministic namespaced keys in Memory/PostgreSQL, API handlers propagate request scope, and legacy unscoped records remain readable for migration compatibility. Memory/store isolation and an HTTP API regression cover same-name profiles in separate projects; server suite: 101/101.
- **PostgreSQL migrations serialized.** Store schema/table/index creation and version bookkeeping now run in one transaction-scoped advisory lock, closing the multi-replica first-boot race that `IF NOT EXISTS` alone does not prevent. The live PostgreSQL CI contract remains the authoritative evidence.
- **S3/MinIO artifact adapter shipped.** `@aqa/artifacts` now exposes `S3ArtifactStore` with content redaction, SHA-256 verification on reads, tenant prefix support, sidecar references and optional S3 Object Lock retention. An injected-client contract test proves the behavior without credentials; bucket versioning, KMS, tenant authorization and production Object Lock policy remain operator/API concerns.
- **Run integration selects durable artifacts.** `aqa run` now selects `S3ArtifactStore` when `AQA_ARTIFACT_S3_BUCKET` is configured, scopes keys under the configured prefix plus run ID, validates retention settings, and keeps filesystem behavior as the local default. Kit backend-selection tests cover both paths without credentials.
- **Helm render gate corrected.** The production-shaped CI render exposed that the runner DNS egress rule still emitted an unrestricted `namespaceSelector: {}` even though the ingress selector was constrained. DNS egress now targets the Kubernetes system namespace label explicitly, so the chart-level assertion matches the intended network boundary.
- **Finding status audit made atomic.** The API now uses a store-level transition primitive that updates the finding and appends its hash-chained audit event in one transaction. PostgreSQL serializes the complete read/hash/write sequence with a transaction advisory lock; MemoryStore mirrors the same contract. Added concurrency assertions for unique sequence/hash values and a memory regression. Local store: 9/9; server: 100/100. PostgreSQL concurrency branch remains CI-only without `AQA_TEST_POSTGRES_DSN`.
- **Queue retry budget and DLQ implemented.** Memory and PostgreSQL queues now persist `attempts`, `max_attempts`, `failed`, and capped failure reason; lease expiry after the budget is terminal, explicit worker failures use `POST /api/runner/jobs/:id/fail`, and stale tokens remain fenced. Server suite: 100/100; PostgreSQL live migration behavior is queued for CI evidence.
- Migrated synchronous `aqa report` Markdown/JSON writes to `FileArtifactStore` sync APIs; report files now receive redaction, atomic replacement and SHA-256 metadata sidecars. The report journey asserts both sidecars; direct-file writers remain only for canonical event/finding JSONL streams.

- **CI runtime findings fixed, not suppressed.** Run `35169917083` exposed two real integration issues: concurrent queue clients raced on `CREATE TABLE`, and the first Docker image pull exceeded Bun's default 5-second test timeout. PostgreSQL migration now uses an advisory lock; the OCI test has an explicit 120-second budget. The failed run is retained as negative evidence; a new run is required.
- **Full acceptance after infrastructure fixes.** Run `35170349159` is green across typecheck/lint, build, Bun + Node 22, PostgreSQL store plus durable queue, real Docker sandbox, CLI smoke, and all 142 Playwright admin tests. This is the authoritative evidence for `e215871`.
- **Playwright CI failure diagnosed as runner provisioning, not an application regression.** GitHub run `35167371462` passed typecheck/lint, workspace build, Bun + Node 22 unit tests, CLI smoke, and the real PostgreSQL 16 contract. The admin job failed before test execution because Playwright 1.60 downloaded Chromium but not its separately required `chromium-headless-shell-1223` executable. CI, root, and admin install commands now provision both browser artifacts explicitly. Next: rerun the gate, then add fresh-process/reconnect and concurrency evidence to the Postgres contract.
- **Second Playwright CI failure narrowed to CLI-version drift.** Run `35168002405` installed revision 1243 through `bunx` but the workspace test runner requested revision 1223, causing all 142 tests to fail at browser launch. CI and root scripts now invoke the package-local `@playwright/test` binary through `bun run`, so install and execution resolve one lockfile version. This needs a fresh CI run before any UI regression conclusion.
- **Full CI acceptance restored.** Run `35168485693` is green across Meta, typecheck/lint, build, PostgreSQL 16 integration (including reconnect and concurrent create), Bun tests, Node 22 tests, CLI smoke, and all 142 Playwright admin tests. This is the first complete journey evidence for the current branch after the Playwright toolchain mismatch. Remaining roadmap work is functional, not a CI false-green.
- **Durable user directory implemented.** `StoreProvider.upsertUser` now persists the authenticated IdP snapshot in both Memory and PostgreSQL stores; the bundled admin HTTP boundary records the user, role/status, and `last_active_at` after successful RBAC authentication. `GET /api/users` therefore survives a PostgreSQL process restart instead of returning an empty production directory. Targeted admin/store tests: 18 passing; the next CI run must re-prove the Postgres user round-trip.
- **Postgres cost aggregation corrected.** `costSummary()` now carries run token counts, USD totals, per-profile aggregation, and daily series instead of returning zero-valued placeholders. The live store contract includes a non-zero cost run and asserts the aggregate; local execution still skips that branch without `AQA_TEST_POSTGRES_DSN`, so CI remains the authoritative evidence.
- **Pack import supply-chain gate added.** `POST /api/packs/import` now runs `@aqa/pack-scanner`, rejects critical/high findings (including unsigned shell packs) before persistence, and verifies a declared SHA-256 signature against the submitted YAML. Added a server regression proving an unsigned shell pack is not stored. Sigstore/cosign trust-root verification and mandatory policy configuration remain separate follow-ups.
- **Real container sandbox backend shipped.** `ContainerSandbox` now executes shell calls through Docker/Podman with read-only root, no network by default, tmpfs `/tmp`, CPU/memory/PID caps, dropped capabilities, `no-new-privileges`, non-root UID, timeout/error handling, and pinned-image configuration. The executor is injectable for unit tests; 9 sandbox tests pass. A Docker runtime integration test remains required because this workstation has no Docker engine.
- **OCI sandbox integration gate added.** CI now runs a separate Docker-backed sandbox contract with `AQA_TEST_CONTAINER_RUNTIME=docker`, asserting the real container reports UID 65532, cannot write `/`, and can read its image filesystem. Local test count is 10/10, with the real branch explicitly skipped when no runtime is configured.
- **Durable runner queue implemented.** Added `PostgresRunnerQueue` with idempotent schema creation, row-locking/`SKIP LOCKED`, visibility leases, attempt counters, fencing tokens, reconnect persistence, and stale-worker ACK rejection. `ApiContext` now consumes the `RunnerQueueLike` contract and awaits both memory and durable implementations. The PostgreSQL integration contract covers two queue clients plus reconnect; production boot wiring still needs an explicit DSN/configuration choice.
- **Durable queue boot wiring completed.** `aqa admin` accepts an injected queue or `queueDsn` and honors `AQA_QUEUE_DSN`, selecting PostgreSQL explicitly while preserving the memory queue for local development. Shutdown closes the durable queue. Targeted kit admin tests: 10 passing; CI must prove the new queue contract against PostgreSQL and the real OCI sandbox.
- **PostgreSQL contract strengthened.** The live integration now closes the first store, opens a fresh store instance against the same DSN, verifies the prior run survives process boundaries, and races eight `createProfile` calls to prove the database uniqueness boundary returns exactly one creator. Local execution without a DSN remains intentionally non-evidence; CI must prove this against PostgreSQL 16.
- **Deep technical review completed; product fixes NOT implemented.** Local `main` synchronized/verified against `origin/main` at `044135cdee0aaaf2e865ca10381ef5e4052ed22e`. Preserved pre-existing `.claude/scheduled_tasks.lock`. Review-only work: no push, PR, publish or changes to product source.
- **Readiness correction:** historical roadmap closure below is not evidence of enterprise readiness. [Detailed review](internal/enterprise-review-2026-09-17.md) records 24 prioritized findings, including reproduced false-green gates/oracles, browser audit accepting tampered events, finding ID collisions, invalid verified status, failed runs reported successful, anonymous admin writes, volatile mutations and failing CJS run/admin commands. Real compiled UI + real loopback API used for the audit negative; no intercepted requests.
- **Evidence:** Windows/Bun 1.3.14/Node 25.2.1; workspace build and typecheck pass; root build only builds documentation; lint fails; unit suite 366 pass / 2 fail (Windows symlink setup and unsupported test skip); CLI E2E 5 pass but does not exercise published CJS entrypoint. GitHub CI run 27881325266 on reviewed main fails lint with downstream jobs skipped. Full Playwright, Node 22/Linux, deployed enterprise journeys and installed registry tarball remain unverified. [Diagnostic reproducer](internal/reviews/2026-09-17-reproduce.mjs) prints observations, not a passing regression suite.
- **Strategy and ecommerce design delivered:** current AI/QA comparison with primary sources in review; [Commerce Assurance proposal](internal/ecommerce-qa-design-2026-09-17.md) covers missing commerce packs, money/order/inventory invariants, ten complete journeys, provider/merchant adapter contracts and safe testing boundaries. Proposal only; implementation requires confirmed pilot constraints and approval.
- **Next:** agree remediation scope, then fail-closed execution/oracles, truthful outcome/audit, bundle/build gates, durable state and authorization/tenant boundaries before enterprise expansion. No production readiness or ecommerce coverage claimed. Existing AGENTS/rules/ADRs were not silently rewritten to adopt proposed architecture.
- **Fase 0 started on `task/v2.0-enterprise-truth-safety`:** runner no longer fabricates a `200` when no probe driver exists; text oracles fail closed on transport errors; all declared cleanup probes execute and emit evidence even after a main-step exception. Added regression tests and preserved informational smoke semantics while release-gate remains red on findings. Targeted runner tests: 12/12; targeted kit contract tests: 6/6; typecheck passed. Next increment: canonical execution outcomes and report/admin alignment.
- **Fase 0 outcome alignment implemented:** `Run.deriveStateFromCompletion()` is now the shared fail-closed state rule consumed by `aqa report` and admin seeding. Completion counters with any error or zero scenarios produce `failed`; missing completion remains `running`. Added schema-level contract tests; schemas/report/admin targeted tests: 62/62. Next: repair the published CJS bundle's `import.meta` paths and add an installed-artifact journey.
- **Fase 0 bundle/state increment verified:** ESM/CJS asset resolution now supports both `dist/commands/*` and the bundled `dist/cli.cjs` layout. Added bundle entrypoint tests and confirmed the external diagnostic run reports `state: failed` for a failed release gate. Kit build succeeds and bundle tests are 5/5; esbuild still emits non-fatal `import.meta` warnings from the ESM fallback. The long-running bundled admin process is intentionally timeout-terminated by the diagnostic and must be covered by a future HTTP lifecycle test.
- **Fase 0 test-harness cleanup:** Windows/Bun symlink tests now log an explicit non-executable limitation instead of throwing from unsupported `node:test` `t.skip()`. Full local suite is now **376 pass / 0 fail**; typecheck passed. This does not claim symlink coverage on the current machine; Node/Linux or Developer Mode remains required for that negative path.
- **PR gate cleanup:** CI exposed 16 repository Biome errors, including seven in the new diagnostic and nine pre-existing docs/config guard scripts. Applied formatter/import/template-only fixes to the exact files; local `bun run lint` now passes across 261 files. No application behavior was changed by this cleanup. The PR must rerun CI before any merge decision.
- **Fresh-checkout build gate repaired:** root `bun run build` now builds docs and all workspaces; CI installs `docs-site`'s locked npm dependencies before invoking it. Local `bun run build` completes across docs, admin, packages and bundled CLI. Vite chunk-size and esbuild `import.meta` warnings remain non-fatal and are tracked separately; the previous `docmd: not found` / docs-only build mismatch is fixed in this branch.

## 2026-05-21

- **v1.9 macro closed — junior quick-start truthing.** Five sub-task PRs merged into `task/v1.9-junior-quickstart-truthing`:
  - **PR #52 — `aqa install-agent-files` CLI verb.** Cables `renderForTargets()` (`@aqa/adapters`) into a real command. `--targets <csv>`, `--project-name <slug>`, `--force`, `--dry-run`. 14 tests. 2 Copilot iter passes (array-form trim + Windows trailing-space in test temp dir, help text path `.github/copilot-instructions.md`, extracted `lastPathSegment`+`slugify` to `cli-utils.ts`, then iter 2: slugify cap to 64 chars + `KNOWN_TARGETS` derived from `adapters` registry).
  - **PR #53 — `aqa report` CLI verb.** Cables `@aqa/reporter` (md+json) reading `events.jsonl`+`findings.jsonl`. `--run-id`, `--format md|json|both`. 24 tests. 3 Copilot iter passes covering: state derivation from `run_finished` payload counters (not "any-finished=succeeded"), mtime-based latest run (vs lexical, broken for `--seed` hashes), missing-artifact fail-fast, `--run-id` LongSlug regex (mirrors `@aqa/schemas` SlugPattern + 256-char cap), `readJsonl` rejects non-object lines (null/array/string/number), symlink protection on run dir AND per-file (`report.md`/`report.json`), reconstructed Run revalidated via `Run.Run.safeParse`.
  - **PR #54 — `aqa admin` CLI verb.** Boots `node:http` server in-process serving bundled `dist/admin/` SPA + delegating `/api/*` to `makeApi()`. `--port`, `--host`, `/api/healthz` always-200. Path-traversal-safe static serving, SPA fallback for client routes. Seeds `MemoryStore` from `.aqa/runs/`. New `packages/pack-author/` package extracted to break the kit↔server build cycle. 7 admin tests + 2 pack-author tests. 3 Copilot iter passes (stale-cycle comment, `--host 0.0.0.0` security warning, pack-author README + named-export comment).
  - **PR #55 — GitHub Packages publish pipeline.** esbuild bundles every workspace+npm dep into `dist/cli.cjs` (~570 KB CJS-in-.cjs). `scripts/publish-prep.mjs` swaps `@aqa/kit` → `@padosoft/agentic-qa-kit` AND strips `@aqa/*` deps (inlined in bundle). `.github/workflows/publish.yml` runs on `v*` tag, `npm publish --provenance --access public` to `https://npm.pkg.github.com`. `LICENSE` copied into `packages/kit/`. 4 publish/bundle tests + POSIX exec-bit assertion. 2 Copilot iter passes (CRITICAL `@aqa/*` strip, stale doc comments, LICENSE missing).
  - **PR #56 — docs refresh.** README + `docs/getting-started.md` rewritten 1:1 with shipped verbs. Adds GH Packages auth `.npmrc` snippet (P1 junior trap), 10-step quick-start, `aqa admin` single-command boot, `bun run e2e:ecosystem` pointer. CHANGELOG `[1.9.0]` entry + backfilled `[1.8.1]`/`[1.8.2]`/`[1.8.3]`.
- **Strategy: 5 PRs in parallel** to amortise Copilot review latency. Each merged in cascade: 52 → 53 → 54 → 55 → 56, with conflict resolution at each step on `packages/kit/package.json` (deps + test scripts) and `packages/kit/src/cli/aqa.ts` (case statements + VALUE_FLAGS). 12 packages, 270 tests pass locally after the cascade.
- **Bundle health snapshot:** `node packages/kit/dist/cli.cjs --version` + `--help` both work end-to-end; all 7 verbs (init / doctor / validate / install-agent-files / run / report / admin / pack new) listed. Bundle size 571 KB (admin SPA + makeApi inlined via dynamic import).
- **Next:** macro PR `task/v1.9-junior-quickstart-truthing` → `main`, then `git tag v1.9.0` + GitHub Release. The tag triggers `.github/workflows/publish.yml` which publishes `@padosoft/agentic-qa-kit@1.9.0` to GitHub Packages.

## 2026-05-20

- **v1.x roadmap closure completed.** Added a dedicated ecosystem Playwright smoke (`packages/admin/test/e2e/ecosystem-live.e2e.ts`) with a single-command stack bootstrap (`scripts/ecosystem-stack.mjs`) that boots `examples/bun-api`, runs a real `aqa run --profile smoke`, serves live `/api/*` from `@aqa/server.makeApi` + `MemoryStore`, and drives the admin against that live backend (`VITE_AQA_SERVER_URL`). The test asserts `finding_emitted` is visible from live `/api/audit` data and that chain verification returns `CHAIN OK`. Command: `bun run e2e:ecosystem`.
- **Docs/progress alignment closed for v1.x.** The previous "in progress/deferred" notes for the v1.6→v1.8 follow-ups are now materially closed in code and release artifacts (`v1.8.2` published). Historical bullets below remain as timeline context; current operational status is: no open PRs, no open issues, ecosystem smoke present and green.
- **v1.8.2 slice closed — CLI smoke now runs a real HTTP end-to-end path.** `scripts/e2e-cli.mjs` no longer stops at version/help/doctor/validate only: it now boots a local HTTP `/healthz` target, seeds a schema-valid local smoke pack/profile, executes `aqa run --profile smoke` with the real HTTP probe runner, and asserts run artifacts are emitted under `.aqa/runs/<run-id>/` (`events.jsonl` non-empty, `findings.jsonl` present). This closes the old “CLI smoke is command-only” gap and makes CI catch integration regressions earlier.
- **v1.8.1 slice closed — audit-chain canonical reconciliation.** Aligned `@aqa/compliance.verifyEventChain` with `@aqa/runner.EventChainWriter`: hash recomputation now excludes `prev_hash` from canonical body (matches writer), and first-record `prev_hash: null` is now treated as canonical instead of expecting all-zero literal in the field. Updated compliance tests and removed stale divergence note in `@aqa/kit` run smoke tests.
- **v1.x docs closure in progress — README/docs refresh pass started.** Removed stale preview/stub wording from README, added the new **How you use it** section after the 7-word model, updated quick-start flow to the current shipped commands (including admin panel boot), and aligned `PACK-AUTHORING.md` with the real HTTP probe runner now shipped in v1.8 (`aqa run` uses `project.sut.base_url` for `http` probes).
- **v1.7 slice 4j closed — AuditChainViewer autoload from live initial chain.** Removed the manual dependency on "Load good chain" for live audit data: `AuditChainViewer` now consumes `initialChain` reactively, resets verify state safely on incoming chain changes, and both Audit pages pass normalized `/api/audit` events via `initialChain`. Added e2e coverage proving `/api/audit` data auto-loads and verifies to `CHAIN OK` without demo-button interaction.
- **v1.7 slice 4f closed — Admin section pages wired to existing endpoints.** PR #40 (`4c93bb7`). PageTokens fetches `GET /api/tokens` with `x-aqa-org` (adapts `@aqa/schemas` ApiToken to the page's fixture shape: `display_name → name`, `last_used_at → last_used`, owner-prefix heuristic for `kind`). PageOrg fetches `GET /api/orgs` and joins live slugs into the subtitle. PageAdminAudit shares the slice 4e `/api/audit` wire with admin-view copy via a new `normalizeAuditEventsForViewer` helper. `fmtDate`/`fmtDateTime` made null-safe (em-dash for missing dates). Create-token modal scope chips switched from pre-schema `runs:write`/`packs:install`/`admin` to the actual `ApiTokenScope` enum. **Users/Roles/SSO deferred** — no server scaffolding exists; out of scope. 4 new e2e tests in `admin-section.e2e.ts`. 6 Copilot review iterations.
- **v1.7 slice 4e closed — Operations admin pages wired.** PR #39 (`99633d5`). PageAudit/PageQueue/PageCost/PageNotifications now read from existing `/api/audit`, `/api/queue`, `/api/cost/summary`, `/api/notifications` with graceful fixture fallback. Schema-true normalizers (server EnqueuedJob → UI job shape, Event → AuditChainViewer demo shape, Notification → fixture title/body/unread). Cost passes explicit `from`/`to` for MTD bounds. SELF resolves from SESSION_USER.id. Notifications filter list derives from server `NotificationKind` enum. 5 new e2e tests in `operations.e2e.ts`. 7 Copilot iterations.
- **v1.7 slice 4d closed — Agents page refactored around real data.** PR #38 (`d97720a`). New `@aqa/schemas Agent`, new `agents:read`/`agents:edit` permissions (legacy `agents:install` aliased), new server CRUD (`GET /api/agents`, `GET /api/agents/:id`, `POST /api/agents/:id/install`, `POST /api/agents/:id/uninstall`), new `Store.listAgents/loadAgent/installAgent/uninstallAgent` (Memory implements + `__test_seedAgent` test-only; Postgres scaffold notImpl). PageAgents fetches the live list with fixture fallback; install/uninstall buttons call real endpoints with in-flight guard + toasts. `Agent.files` validated as `SafeRepoPath` (rejects leading `/`, drive letters, `..` segments, UNC roots). Empty server list is authoritative. Header counts sourced from state. 5 new e2e tests in `agents.e2e.ts`. 7 Copilot iterations.
- **v1.7 slice 4c.7+4c.8 admin closed — Scenario edit/clone YAML wizard.** PR #37 (`a1a0d0a`). Shared `ScenarioYamlWizard` (`mode: 'edit' | 'clone'`) with a YAML textarea seeded from a schema-conforming stub (or, in edit mode, the persisted override / created body). Client parses YAML via the new `yaml` admin dep; debounced 150ms with sync-on-seed. UX errors block submit: parse error, body-not-an-object, missing/non-string id, Slug-regex violation (matches `@aqa/schemas` Slug), clone-empty/clone-same-as-source/collision, edit path/body id mismatch. App-level `updatedScenarios` + `createdScenarios` Maps + `aqa:scenario-updated/-created` events with prototype-pollution guard (`safeMergeObject` strips `__proto__`/`constructor`/`prototype`). Scenario fixtures migrated from dotted ids (`api.tenant.cross_tenant_search`) to dashed Slug-compliant ids; tree grouping switched to explicit `category` field. Spec preview re-renders from override via `__aqaYamlStringify`. 10 e2e tests in `scenario-yaml.e2e.ts`. 8 Copilot iterations.
- **v1.7 slices 4c.1 through 4c.8 closed.** Profile Delete/Edit/Clone (PRs #29/#30/#31), Risk Delete/Edit (PRs #32/#33), Scenario Delete (PR #34), Scenario Edit/Clone server-side hardening (PRs #35/#36). All 8 micro-PRs squash-merged; the architecture lessons (`inFlightRef` synchronous guard, captured-submittedId stale-submit guard, render-time refs not effect-time, modal close-affordance inertness during submit, App-level lifted state with `aqa:*` CustomEvents, atomic `createX` in Store, mock-id migration to schema-conforming Slug) carried through every later slice.
- **Final v1.7 closing step.** Tag `v1.7.0`, GitHub release notes covering the full slice 4 surface (Operations + Admin sections wired to existing routes, Agents fully end-to-end, Scenario admin via YAML, Profile/Risk/Scenario CRUD complete).
- **v1.7 slice 4g closed — Users + Roles admin pages wired** (post-v1.7.0 patch). PR #42 (`77f3b1c`). New `GET /api/users` (returns the store's directory snapshot, `settings:read`-gated) and `GET /api/roles` (returns the `@aqa/auth` `rolePermissions` matrix + `Permission.options` enum for the "every permission" axis, so wildcard-only perms like `settings:edit` show as rows in the live grid). New `StoreProvider.listUsers()` + shared `StoreUserDirectoryEntry` type (exported from `@aqa/store` so adapters and API handlers agree on field names). PageUsers fetches with display_name→name / suspended→disabled adapter; PageRoles renders the live (permission × role) matrix with `admin:everything` as wildcard. Fixture fallbacks preserved. 4 e2e + 3 server tests. 2 Copilot iterations. **SSO config wiring still deferred** — needs a new schema, tracked as a future slice.
- **v1.7 slice 4h closed — SSO config wiring completed.** Added `SsoConfig` schema in `@aqa/schemas` (+ fixture + JSON schema emitter/export), `StoreProvider.loadSsoConfig()` in `@aqa/store` (Memory implementation + Postgres scaffold), new `GET /api/sso/config` (`settings:read`) in `@aqa/server` with schema-validation guard, and Admin SSO page wire-up to live config with fixture fallback. Added server/store tests and admin e2e coverage for live/fallback SSO rendering.
- **v1.7 slice 4i closed — SSO config write-path enabled.** Added `StoreProvider.saveSsoConfig()` (Memory implementation + Postgres scaffold), new `PUT /api/sso/config` (`settings:edit`) in `@aqa/server` with `SsoConfig` schema validation, and Admin SSO save wiring to persist live edits. Security hardening applied during review: removed `dangerouslySetInnerHTML` in SSO alert, added explicit `config: null` rendering state, and stabilized domain chip keys. Added store/server tests plus admin e2e for `PUT /api/sso/config`.

## 2026-05-17

- Started `task/bootstrap-governance` from `main` (commit `c25dd4e` = initial). Goal: stand up the process governance — branch strategy, validation loop, Copilot review automation, docs scaffolding, repo tooling — **before** any product code is written.
- **Task 0 closed.** PR #1 merged (`d9cb4b3`). Tag `v0.0.1-governance` pushed. 8 Copilot review iterations; 52 actionable comments addressed.
- **Task 1 closed.** PR #2 merged (`3871cd1`). `@aqa/schemas` — Zod source of truth + JSON Schema (Draft 2020-12) generated artifacts. Determinism contract from §3.1 codified in `Finding`. Hash-chained audit codified in `Event`. 4 Copilot review passes; 29 actionable comments addressed. Follow-up #3 tracks remaining JSON-Schema parity work.
- **Task 2 closed.** PR #4 merged (`895cec9`). `@aqa/kit` — `aqa` CLI (init/doctor/validate) + project profiler. CI bun + Node 22 jobs aligned to per-package script runner; topological build added (run-workspace-script DFS sort) so downstream packages can resolve workspace imports through dist/.
- **Task 3 closed.** PR #5 merged. `@aqa/pack-loader` + 5 baseline packs (core / api-core / web-ui / llm-agent / security). One Copilot review pass; 15 actionable comments addressed (slug placeholders, manifest descriptions, OWASP coverage scoped to v0.1.0 subset).
- **Task 4 closed.** PR #6 merged. `@aqa/adapters` — Claude, Codex, Gemini, Copilot adapters with per-target capability profiles and deterministic `render(ctx)`.
- **Task 5 closed.** PR #7 merged. `@aqa/runner` — RunLifecycle state machine, hash-chained EventChainWriter (end-to-end verified), FindingsWriter (in-run dedup), built-in oracles, runScenario orchestrator.
- **Task 6 closed.** PR #8 merged. `@aqa/reporter` — Markdown + JSON reporters + 3-level replay artifact generator (repro.sh, repro.curl, repro.playwright.ts).
- **Task 7 — admin panel bootstrap done.** `packages/admin` (`@aqa/admin`, private) — Vite + React 19 + TS strict scaffold with a 12-route sidebar shell (Dashboard, Runs, Findings, Risk map, Profiles, Packs, Scenarios, Agents, Replay, Audit log, Cost, Settings). Each route renders a typed `ScreenPlaceholder` documenting what lands when. Vite build produces `dist/` (197 KB JS, gzip 62 KB). Full Tailwind 4 wiring, TanStack Router migration, and per-screen data wiring are deferred to Task 17 (`task/admin-editing`). 4 node:test tests; 86 repo-wide.
- **Repo health snapshot:** 9 packages (schemas, kit, pack-loader, adapters, runner, reporter, admin + 5 packs), 86 tests passing under both Bun and Node 22, biome + tsc strict zero errors, hash-chained audit verified, JSON Schemas Draft 2020-12 compliant.
- **Next:** Task 8 — `docs/getting-started.md` (junior 15-min onboarding), `docs/architecture/reference.md` (real diagram + component map), `docs/methodology/agentic-qa.md` (Risk/Invariant/Probe/Oracle), ADR-001..ADR-009, examples/bun-api, examples/nextjs-saas, then v0.1.0 release tag. Task 9 (FINAL) — knowledge consolidation across LESSON.md / RULES.md / agent files.
- **Tasks 8 — 22 closed.** v0.1.0 through v0.6.0 tags pushed (#9..#16). Stack grew to 18 packages: schemas, kit, pack-loader, pack-scanner, adapters, llm-adapters, runner, reporter, admin, admin-core, auth, sandbox, store, generator, server, clustering, methodology, + 5 packs. Deploy scaffolds (`deploy/helm`, `deploy/terraform`, `scripts/air-gap-install.sh`) shipped with explicit "v0.6 / v1.0" labels.
- **Task 23 — v1.0 readiness in progress.** `@aqa/compliance` ships SOC2/ISO controls catalog (`CONTROL_MAPPINGS`, `controlsCoverage`) + hash-chain audit verifier (`verifyEventChain`, `aqa-audit-verify` CLI). `docs/compliance/soc2-iso-mapping.md` is the auditor-facing source of truth; `docs/compliance/pen-test-scope.md` is the engagement contract. 7 new tests; 165 repo-wide.
- **v1.1 polish shipped** (PR #18, tag `v1.1.0`). README banner now points to a real PNG. `deploy/helm` is feature-complete (runner StatefulSet w/ per-pod PVC, optional Ingress + TLS, NetworkPolicy that confines runner egress, optional in-cluster Postgres subchart). Three examples: `bun-api`, `nextjs-saas` (session-cookie invariant), `laravel-app` (demonstrates language-agnostic targeting). `docs/LESSON.md` consolidated retrospective. GitHub Releases backfilled for every tag from `v0.0.1-governance` through `v1.1.0`. README pre-alpha badge replaced with GA + Release badges.

## 2026-05-18

## 2026-09-17 — v2.0 enterprise truth/safety (in progress)

- **Audit viewer truthfulness increment shipped locally.** The admin now preserves the raw API audit record and verifies `prev_hash` plus the canonical SHA-256 digest in the browser via Web Crypto. A live tampered record therefore renders `CHAIN BROKEN`; the previous continuity-only check could accept altered payloads. The live Playwright fixture now computes real hashes and the reproduction harness asserts the built SPA against the real `runAdmin()` HTTP server with zero API mocks.
- **Evidence:** `node docs/internal/reviews/2026-09-17-reproduce.mjs` reports `audit-verifier-backend.backendAcceptsTamper=false` and `built-ui-real-api-tamper.chainOk=false`; `bun run --filter @aqa/admin build` and admin typecheck pass. The ecosystem E2E remains environment-blocked by a Bun cache `ENOENT` while installing `hono`, not by an assertion failure.
- **Next:** tenant/auth enforcement at the HTTP adapter boundary, then durable store semantics and ecommerce journey packs. Copilot review explicitly waived by maintainer instruction for this roadmap run.
- **HTTP authorization boundary increment shipped.** `aqa admin` now authenticates and enforces each route's declared RBAC permission before dispatching to `makeApi()`; `AdminOptions.authenticate` allows a real OIDC/JWT verifier to be injected. An unauthenticated `/api/orgs` request is covered by a live HTTP test and returns 401. The default localhost mode remains an explicitly local admin identity and is not an enterprise identity provider.
- **Finding attestation increment shipped.** `POST /api/findings/:id/status` now requires tenant scope, loads the authoritative run, validates the complete candidate Finding through the Zod schema before mutation, and emits a hash-chained audit event containing actor, old/new status and reason. Invalid `verified`/`duplicate` transitions are rejected without changing state. Server tests: 93 passing.
- **Non-loopback admin hardening shipped.** `aqa admin --host 0.0.0.0` now refuses to boot unless an explicit authentication callback is supplied. This closes the unsafe LAN default while keeping localhost development convenient.
- **Replay truth increment shipped.** `verifyScenario()` now computes a stable SHA-256 failure fingerprint from scenario and failed-oracle reasons, records it per attempt, and optionally compares it with the original finding fingerprint. Different failures no longer count as deterministic reproduction; runner tests: 26 passing.
- **Replay artifact integration shipped.** `aqa run` now materializes `replay/repro.sh` and `replay/repro.curl` for every HTTP finding before finalizing `run_finished`; artifact count/errors are recorded in the audit event and write failures fail the run. Relative probes resolve against the configured SUT base URL and header values are shell-quoted. Kit/reporter replay and run-command tests: 29 passing.
- **Queue fencing increment shipped.** `RunnerQueue.dequeue()` issues a fresh lease token and returns a snapshot; `ack(id, token)` rejects missing/stale worker tokens, while requeue/kill clear them. A real stale-worker interleaving test now proves the old worker cannot close the reassigned job. Server tests: 92 passing.
- **Tenant finding isolation increment shipped.** `GET /api/findings` now requires project scope and resolves each finding through its authoritative run before returning it; findings from another project and findings with no resolvable run are excluded. Added a cross-project server regression; server tests: 93 passing.
- **HTTP probe safety increment shipped.** The real HTTP driver now defaults to the configured target origin, rejects non-allowlisted absolute URLs, does not follow redirects, bounds response evidence to 1 MiB, and reports oversized/invalid responses as execution errors. Negative origin and body-size tests pass; runner tests: 27 passing.
- **Cost safety increment shipped.** `BudgetTracker` no longer treats an unknown model as free: `charge()` records a pricing error and exhausts the tracker, while `wouldExhaust()` returns true. Existing known-model arithmetic is unchanged; cost tests: 5 passing.
- **Pre-persistence redaction increment shipped.** Audit payloads are recursively redacted before canonical hashing/persistence and finding text/evidence is sanitized before JSONL output. Bearer tokens, secret-like keys, PAN-shaped values and related sensitive strings are not retained; runner tests: 28 passing.
- **Replay command hardening shipped.** Generated curl artifacts now resolve relative URLs against the SUT base URL, use `--data-raw`, preserve expected 4xx responses (`-sS` without `-f`), and shell-escape method/URL/header/body arguments including embedded single quotes. Reporter tests cover the hostile quoting case.
- **Commerce Assurance foundation shipped.** Added new `@aqa/commerce` package with versioned `Money`, `CommerceContext`, `OrderSnapshot`, `PaymentSnapshot`, `InventorySnapshot` and `JourneyOutcome` contracts plus fail-closed currency/oversell invariants. Four contract tests pass after `bun install`; this is the contract layer, not yet a merchant/payment adapter or full checkout journey.
- **Commerce reference vertical slice shipped.** `@aqa/commerce` now includes a deterministic in-memory merchant for synthetic carts, checkout, captured payment snapshots, tenant/customer authorization, idempotency-key replay and no-backorder inventory fencing. Added tests for exactly-once retry behavior, incompatible-key rejection, last-item competition and cross-customer/tenant denial. This is a reference test merchant; it is not evidence for a real payment provider or durable production persistence.
- **Refund integrity slice shipped.** The reference merchant now models a refund ledger snapshot, cumulative refunded amount, partial/full refund states, strict currency matching, idempotent refund retries and over-refund rejection. Nine commerce tests pass; real provider reconciliation and durable transactional persistence remain open roadmap work.
- **OIDC authentication slice shipped.** `OidcAdapter` now performs provider discovery, Authorization Code + optional S256 PKCE token exchange, UserInfo retrieval, strict `User`/`AuthSession` validation and supported-role mapping; missing secret, endpoint, identity or role fails closed. Auth tests: 7 pass. Application-level CSRF state binding, session cookie/rotation and durable tenant membership are still required for production deployment.
- **HTTP tenant-membership boundary shipped.** `ApiContext.authorizeScope` and the bundled admin dispatcher now support server-side org/project membership checks after authentication/RBAC, with `403` on a valid-role user requesting an unauthorized scope. Added a real HTTP boot regression; server/admin boundary tests: 97 pass. The local loopback admin default remains development-only, and standalone deployments must provide the callback.
- **Postgres persistence slice shipped.** Replaced the `PostgresStore` not-implemented scaffold with a real `postgres` driver adapter: idempotent schema marker/table creation, durable JSONB records, tenant indexes, hash-addressed audit events, atomic profile/scenario creates, server-side filtering and graceful connection-close semantics. Store tests: 8 pass; the real-DB contract is conditional on `AQA_TEST_POSTGRES_DSN` and was not claimed locally without a database.
- **Postgres CI evidence added.** `.github/workflows/ci.yml` now provisions PostgreSQL 16 as a service and runs the store integration contract with an ephemeral CI DSN after a fresh workspace build. Local Docker is unavailable, so the GitHub job remains the authoritative runtime evidence still to be observed.
- **CI fresh-job build regression fixed.** Package-only jobs now invoke `build:workspace`; jobs that require the root docs build install `docs-site` dependencies with `npm ci` first. This removes the observed `docmd: not found` exit 127 from independent CI jobs.
- **Postgres CI round-trip bug fixed.** The first real PostgreSQL 16 run exposed that JSONB values returned through the unsafe driver path can be strings; centralized decoding now restores typed payloads before reads/event results. Local store tests remain 8/8; CI must re-prove the live contract.
- **Finding identity increment shipped.** New runner findings use 20-digit UUID-derived numeric suffixes instead of the per-run scenario counter, preventing cross-run overwrites in stores keyed by `finding.id`; historical four-digit IDs remain schema-compatible. A regression test and diagnostic prove two runs preserve two distinct findings.

- **v1.7 slices 1+2 shipped — pack authoring tutorial + `aqa pack new` CLI.** PR #25 merged (`6cc0013`), prerelease tag `v1.7.0-rc.1` published. **19 review iterations** with Copilot + Codex; the convergence pattern hit a sharp tail (5→1→4→2→1→2→0 real items per round) after Copilot started re-flagging the same ~13 already-addressed comments. Real issues caught and fixed before merge: slug-length validation against derived-ID schema cap (52-char limit), in-memory schema validation of generated Scenario/RiskMap/PackManifest before writing, symlink rejection at both packs/ parent and packDir, non-directory parent rejection, atomic backup-rename `--force` (failed scaffolds restore the original pack), `package.json#files` matching reality, scoped publish guidance, schema-valid profile snippet, integration test asserts `scn-pack-demo-starter` actually executed (rejects false-positives via bundled packs), honest NO_NETWORK_PROBE documentation. 54 tests in `@aqa/kit` (12 pack-new + 42 run-cmd). **Still pending in v1.7:** slice 3 (admin Create-pack wizard) and slice 4 (audit + wire/implement 81 silent admin placeholder buttons, plan in `docs/internal/admin-placeholder-audit.md`). Final `v1.7.0` tag after those slices ship.
- **v1.6 shipped — `aqa run` + bundled packs + ecosystem foundation.** PR #24 merged (`21d7b10`), tag `v1.6.0` pushed, GitHub release published. The CLI now has the missing `aqa run` command that closes the loop between `aqa init` and a real audit trail. **21 review iterations** with Copilot + Codex, every one surfacing a real bug or coverage gap (zero false alarms). 42 TDD tests in `packages/kit/test/run-cmd.test.ts` cover every behavior. Highlights: SUT-aware init pack selection, three-tier pack discovery (project / node_modules / kit-bundled — all 5 baseline packs now ship inside `@aqa/kit`'s tarball via `bundle-packs.mjs`), atomic run-dir creation (TOCTOU-safe for concurrent seeded runs), path-traversal + symlink-escape rejection, `applies_when` filtering, manifest-name dedup with priority, legacy bare-slug aliasing, agent-mode rejection until that driver lands, unrelated-broken-pack tolerance with structured `warnings`, capped error strings (`MAX_DETAIL_PER_KIND`), detail samples in `run_finished` audit event for auditors. **Known scoped follow-ups:** real HTTP probe runner (current is no-network stub → release-gate strict semantics deferred), `EventChainWriter` ↔ `verifyEventChain` canonical-form reconciliation, browser-driven ecosystem smoke.
- **Next macro task — v1.7 pack-authoring story.** Per user confirmation: (a) `docs/PACK-AUTHORING.md` community tutorial, (b) `aqa pack new <slug>` CLI scaffolding, (c) Admin "Create pack" wizard wired over the new CLI. PLUS: a full audit pass on every placeholder button/interaction in the admin panel — no `onClick={() => {}}` or no-op silent clicks. Each placeholder either gets wired to a real endpoint, gets a client-side implementation, or gets an explicit "decorative" doc note.
- **v1.5 admin design integration shipped.** PR #23 merged (`f7b879f`), tag `v1.5.0` pushed, GitHub release created. The 30-screen hi-fi prototype from Claude Design is now the official admin web panel: bundled into `packages/admin/src/app.tsx` (8.9k LOC, `@ts-nocheck`), token-driven CSS, Vite production build. New `E2E (Playwright, admin UI)` CI job runs the full Playwright suite (`*.e2e.ts`) — per-screen smoke for all 19 nav routes + audit-chain verify (OK/tampered) + Findings views (Clusters/List/Kanban) + Replay tabs + risk-map matrix + theme + palette. Total 36 Playwright tests green in 1m27s. **Known scoped tradeoffs (deferred):** in-memory routing only (not URL-driven), live-mode still reads in-file mocks (no real fetch layer wired). Both intentional for the design port; will be picked up in v1.6.
- **v1.5 lessons captured.** Documented in `docs/LESSON.md`: (a) bundled-prototype `@ts-nocheck` pattern with Biome ignore-list; (b) `window.useTweaks` fallback injection for design-tool-only hooks; (c) Playwright `.e2e.ts` extension to avoid Bun's test runner picking it up; (d) nav-item locator pattern (no `$` anchor, escape regex metas, target prototype's actual `.replay-tab`/`.seg-btn` classes, not `getByRole('button')`).
- **Next macro task — v1.6 ecosystem end-to-end smoke.** Full end-to-end ecosystem smoke via Playwright: boot server + runner pool + admin in a single command, drive a real `aqa run` against `examples/bun-api`, verify findings appear in the admin, verify audit chain remains valid. TDD: any broken path → failing test first, then fix. After that, the README/docs refresh closing step (see below).
- **v1.4 admin API surface (in flight).** Expanded `packages/server`'s `makeApi()` from 4 to 28 routes covering everything `docs/design/admin-panel-spec-v2.md` references: runs detail + events, finding status mutation, packs CRUD, profiles CRUD, risks CRUD, scenarios edit, audit query, cost summary, queue snapshot, notifications, saved views, API tokens, tenancy (orgs + projects). `StoreProvider` extended with matching methods; `MemoryStore` implements all of them (Postgres scaffold throws `not implemented`). New `@aqa/schemas` namespaces: `Notification`, `SavedView`, `ApiToken`, `CostSummary`, `Tenancy`. Multi-tenant via `x-aqa-org` / `x-aqa-project` headers. 8 new tests; 184 repo-wide.
- **Design brief for admin v2 shipped.** `docs/design/admin-panel-spec-v2.md` — self-contained enterprise-grade spec (tokens, 30 screens, full component library, interaction patterns, a11y, perf budget, deliverables checklist) so an external designer (or Claude Design) can build the React template in parallel.
- **Next macro task (post-admin-design).** After admin v2 design lands and integrates: full end-to-end ecosystem smoke via Playwright — boot server + runner pool + admin in a single command, drive a real `aqa run` against `examples/bun-api`, verify findings appear in the admin, verify audit chain remains valid. TDD: any broken path → failing test first, then fix.
- **Issue #3 closed.** Mirrored 3 remaining Zod superRefines into JSON Schema (Finding `status='duplicate' ⇒ duplicate_of`, ReproLevel `deterministic=true ⇒ attempts >= 1`, ProfilesFile `profile.name === key` via `$comment`). Added Ajv 2020 round-trip test (`packages/schemas/test/ajv-roundtrip.test.ts`) that validates every fixture against the emitted schema — catches Zod/JSON-Schema divergence at build time. 204 tests repo-wide. Patches resolve `#/definitions/<name>` indirection emitted by zod-to-json-schema.
- **PR #22 local gates verified (2026-05-18).** `bun install` ✅, `bun run build` ✅, `bun run typecheck` ✅, `bun run lint` ✅ (4 warnings, no errors), `bun test` ✅ 204/204.
- **BLOCKER — Copilot review request (PR #22).** Both `gh pr edit --add-reviewer copilot-pull-request-reviewer` and GraphQL `requestReviewsByLogin` return HTTP 403 (DNS monitoring proxy blocks GitHub API). **Action required:** please open PR #22 in the GitHub UI and manually add `copilot-pull-request-reviewer` from the Reviewers sidebar panel.
- **Final closing step (after every macro task above is closed).** README + docs refresh pass:
  1. Audit every `v0.x.x` reference in `README.md` — replace stale ones with the current shipped surface or drop.
  2. Quick-start section: remove the "preview of v0.1.0" disclaimer; write the definitive end-to-end junior flow that **actually works today**, including booting the web admin panel. No more "this will work in vX" hedging.
  3. Architecture section in `README.md`: refresh diagram + component list to match the 18 packages shipped (schemas, kit, pack-loader, pack-scanner, adapters, llm-adapters, runner, reporter, admin, admin-core, auth, sandbox, store, generator, server, clustering, methodology, compliance).
  4. `docs/`: audit every file, prune obsolete content, keep only current/good. Anything that says "stub" or "lands in vX" must either be filled in or removed.
  5. After "The mental model in 7 words" section, add a new section titled **"How you use it"** — clean, concise, written in the same rhythm as "7 words" — describing the end-to-end junior workflow:
     - `aqa init` (detect repo, scaffold `.aqa/`)
     - edit `risk-map.yaml` (declare what matters)
     - install agent files for your coding agent
     - `aqa run --profile smoke` (skills + scenarios + runner + oracles)
     - open admin panel (`bun --filter @aqa/admin dev`)
     - inspect findings, replay deterministically, verify audit chain
     - iterate on risks + scenarios until release-gate green
  6. Tag the README/docs refresh PR as the official **closure** of the agentic-qa-kit v1.x line.

## 2026-05-18 — earlier

- **v1.2 admin wired.** `@aqa/admin` migrated from inline-style placeholder shell to a real SPA: Tailwind 4 + TanStack Router + TanStack Query + Zustand + lucide-react. 12 screens shipped end-to-end: Dashboard (KPIs), Runs (table), Findings (clustered via content-hash signature, async via Web Crypto), Risk map (grouped by category), Profiles, Packs (with signature badge), Scenarios (pack→scenario tree), Agents (per-agent instruction-file detection), Replay (per-finding repro.sh / repro.curl preview + verify button), Audit log (paste events.jsonl → re-walk the sha256 chain in-browser; "Load good chain" / "Load tampered chain" demo buttons), Cost (bar by profile), Settings (theme toggle).
- **Browser-side hash-chain verifier.** `node:crypto` is not Vite-safe, so the admin re-implements `verifyEventChain` + `signatureOf` on top of `crypto.subtle.digest`. The CLI version in `@aqa/compliance` remains the SOC2 source of truth; the in-browser copy is a UX affordance only. Documented in `docs/LESSON.md`.
- Build: 376 KB JS (116 KB gzip), Tailwind CSS 9.94 KB (2.92 KB gzip). 165 tests still pass.
# 2026-09-17 — pack installation safety parity

- Closed the legacy `POST /api/packs` supply-chain bypass: JSON manifests now pass schema validation and the same critical/high scanner gate as YAML imports.
- Added duplicate protection (`409 EEXIST`) with explicit `force=true` replacement semantics; malformed, unsigned shell, and invalid signed JSON manifests are rejected before persistence.
- Added canonical parsed-JSON digest verification to `@aqa/pack-scanner`; this is integrity verification only and does not establish Sigstore publisher trust.
- Evidence: `bun run --filter @aqa/pack-scanner test` (8 passed), `bun run --filter @aqa/server test` (96 passed), `bun run --filter @aqa/server typecheck` (passed).
- Next: implement durable artifact storage and redaction-aware artifact lifecycle; remaining enterprise gaps include WORM audit transactionality, OIDC/Vault/S3/Sigstore trust roots, live LLM adapters, and ecommerce journey packs.

# 2026-09-17 — artifact storage contract

- Added `@aqa/artifacts` with `ArtifactStore` and local `FileArtifactStore` implementation: content SHA-256 references, atomic temp-file writes, metadata sidecars, safe relative keys, traversal rejection, text/JSON pre-write redaction and explicit binary API.
- Added canary tests for bearer/JWT/AWS/PAN/email redaction, JSON key redaction, binary byte preservation, deletion and traversal resistance; added ADR-013.
- Evidence: `bun run --filter @aqa/artifacts test` (3 passed), typecheck and build passed.
- Honest gap: existing runner/reporter/server paths still write directly to `.aqa/runs`; wiring them to this contract plus S3/MinIO/WORM/tenant authorization is the next acceptance slice.
- Wired `aqa run` replay generation through `FileArtifactStore`; the real run journey now produces replay files plus content metadata sidecars through the redaction-aware boundary. The event/finding writers and `aqa report` remain direct-file paths and are intentionally the next migration surface.

# 2026-09-17 — live LLM adapter baseline

- Replaced the live-provider gap for OpenAI-compatible `openai`, `ollama` and `vllm` with a real HTTP adapter: injectable fetch for deterministic tests, timeout cancellation, bounded output tokens, model-version hash, usage extraction, redacted request/response/error content and BYOK endpoint/key options.
- Anthropic/Google/Cohere/Bedrock remain explicit scaffolds until provider-specific contracts, auth, regional routing and replay/fixture tests are implemented; this is not a claim of complete multi-vendor production readiness.
- Evidence: `bun run --filter @aqa/llm-adapters test` (8 passed), typecheck and Biome passed.

# 2026-09-17 — OIDC admin session journey

- Added `OidcSessionManager` with one-time state, S256 PKCE binding, short-lived sessions, HttpOnly cookie handling and explicit revoke; added `aqa admin` `/auth/login`, `/auth/callback` and `POST /auth/logout` routes.
- OIDC mode is fail-closed and cannot silently use the local admin identity. Loopback cookie security is configurable so HTTP development does not emit an unusable `Secure` cookie; non-loopback defaults to `Secure`.
- Complete journey evidence: admin test performs login redirect, callback, authenticated API request, logout and post-logout denial. Auth tests: 8 passed; kit tests: 107 passed, 2 platform skips; kit typecheck and Biome passed.
- Remaining enterprise gap: the session map is process-local; multi-replica production still needs a shared encrypted session store and reverse-proxy TLS contract.

# 2026-09-17 — deployment hardening

- Hardened the Helm chart: durable server audit PVC enabled by default, non-root UID/GID, RuntimeDefault seccomp, dropped capabilities, no service-account token, read-only root filesystem, termination grace period, server startup/readiness/liveness TCP probes, and constrained ingress-controller namespace selector instead of `{}`.
- Documented the operational limits: TCP probes are temporary until a deployable server wrapper exposes a dedicated health endpoint; audit PVC is not WORM or a backup; operators must set the real ingress namespace labels.
- Helm CLI is not installed in this Windows workspace, so chart rendering/lint remains a CI/operator-side verification gap for this increment.
- Added a GitHub `Validate Helm deployment chart` job to lint and render both default and ingress/TLS production-shaped values, assert the audit PVC is rendered, and reject an unrestricted ingress namespace selector. Local Helm remains unavailable, but the verification is now executable in CI.

# 2026-09-17 — runner lease completion boundary

- Added `POST /api/runner/jobs/:id/ack`; workers must present the current fencing `lease_token`, and stale/unknown tokens return `409` without completing the job.
- Added optional `runnerAuthorize` enforcement to both dequeue and ACK routes, preserving local test compatibility while allowing production deployments to require a dedicated runner credential rather than a user session.
- Evidence: server suite 98/98 passed, server typecheck and Biome passed. PostgreSQL lease fencing remains covered by the existing live CI integration.
- Exposed the same `runnerAuthorize` callback through `runAdmin`, with a complete admin HTTP test proving unauthorized dequeue is `401` and the configured runner credential reaches the route.
# 2026-09-17 — fix→verify replay slice

- Added `aqa verify <finding-id>` as the first executable fix→verify loop: it locates a persisted finding, resolves the owning scenario from project or installed packs, requires a real `--base-url` or an injected probe runner, replays with bounded attempts, and writes a unique verification evidence artifact beside the run.
- Deterministic replay returns exit code 0; completed but flaky replay returns exit code 2; missing finding/scenario or missing network boundary fails closed. The command deliberately does not auto-close findings or imply CI/PR/deployment verification.
- Evidence: `bun run --filter @aqa/runner build`; `bun run --filter @aqa/kit typecheck`; `bun run --filter @aqa/kit test` (113 passed, 2 platform skips); and `git diff --check` all pass. Remaining slice: publish the command and connect verification evidence to durable finding status/audit events.

# 2026-09-17 — risk coverage aggregation slice

- Added `measureRiskCoverage()` to derive the documented coverage score from a validated risk map, scenario risk/invariant links, oracle declarations, and timestamped run observations. It counts recent pass rate, deterministic replay, flaky scenario history, and stale evidence without treating missing artifacts as success.
- The aggregation is persistence-agnostic so CLI, API, and warehouse adapters can share one deterministic boundary. It currently consumes supplied observations; store/API ingestion and an admin coverage endpoint remain open.
- Evidence: `bun run --filter @aqa/methodology typecheck`; `bun run --filter @aqa/methodology test` (9/9); `bun run lint`.

# 2026-09-17 — root-cause clustering slice

- Extended `@aqa/clustering` with stable `root_cause_id` derivation and explainable priority (`severity × confidence × blast_radius / cost_to_fix_estimate`) while preserving conservative fingerprint-only grouping. Optional finding estimates are schema-validated and bounded; missing estimates default to neutral `1`.
- Evidence and remaining gap: clustering tests/typecheck/lint prove deterministic grouping and prioritization. Cross-fingerprint semantic clustering, persistent root-cause lifecycle, and bulk status transitions remain separate work.

# 2026-09-17 — external result ingestion slice

- Added `@aqa/ingest` and `aqa ingest junit|sast <file>`. JUnit pass/failure/error/skip and Semgrep-compatible SAST results now normalize into a common bounded report with stable fingerprints; CLI writes through the redaction-aware artifact store under `.aqa/ingest/`.
- JUnit rejects `DOCTYPE`/`ENTITY` declarations and all inputs are capped at 10 MiB. Ingestion remains evidence-only: it does not auto-verify or close findings. Playwright trace, k6, mutation and provider-specific adapters remain open.
- Evidence: ingest package typecheck and 4/4 tests; kit typecheck and 117 tests (115 passed, 2 platform skips); repository lint passed.

# 2026-09-17 — deterministic STRIDE discovery slice

- Added `aqa risk discover --method stride [--scope <path>]`, producing six schema-validated STRIDE baseline risks with one explicit invariant each, mapped to AQA risk categories and tagged with scope. Existing maps are preserved unless `--force` is explicit; symlink targets and traversal scopes fail closed.
- This is a deterministic baseline, not autonomous source-code truth. FMEA, OWASP import, attack trees, AST/LLM-assisted discovery, and human approval/versioning remain open extensions.
- Evidence: kit typecheck; kit suite 120 tests (118 passed, 2 platform skips); repository lint and diff check passed.

# 2026-09-17 — tenant risk coverage API slice

- Added `GET /api/risk-coverage`, requiring org/project scope and `risk-map:read`. It loads tenant-scoped risks and scenarios plus persisted run oracle events, ignores incomplete scenario observations, and delegates scoring to `@aqa/methodology`.
- Complete API evidence: server suite 108 tests (107 passed, 1 live PostgreSQL EventBus skip); server typecheck and repository lint passed. Admin UI projection and durable event retention/aggregation remain open.

# 2026-09-17 — SLO/error-budget decision slice

- Added `evaluateSlo()` to `@aqa/observability`: validates event counts and target, computes allowed bad events, remaining budget, burn rate and explicit `no_data`/`within_budget`/`budget_warning`/`budget_exhausted` reason codes.
- Evidence: observability typecheck and 7/7 tests; repository lint passed. Runtime metric wiring, OTel Collector export and operational dashboards/alerts remain open.

# 2026-09-17 — run tenant identity hardening

- Added optional `org` to the Run schema and generated JSON Schema, propagated org filtering through Memory/Postgres stores and all scoped run/finding API checks. Scoped reads now fail closed for legacy runs without an org and prevent same-project-slug cross-org leakage.
- Evidence: schema suite 59/59, store build, server typecheck, server suite 108 (107 passed, 1 PostgreSQL EventBus skip), repository lint. Worker persistence must populate `Run.org` from the authenticated queue scope; unscoped local CLI runs remain intentionally local-only.

# 2026-09-17 — tenant quota admission slice

- Added validated per-organization/project admission limits for concurrent runs and declared scenario units to both the memory queue and the PostgreSQL queue. Idempotent retries return the existing job before quota evaluation; API callers receive a bounded `429 RESOURCE_QUOTA_EXCEEDED` response with no secret or payload echo.
- PostgreSQL quota admission now serializes each scoped decision with a transaction-scoped advisory lock before reading active jobs and inserting. The queue still needs durable quota configuration/metrics and runtime kill-switch propagation, but the previous snapshot-plus-insert race is closed.
- Evidence: server typecheck, server suite (109 passed plus one PostgreSQL EventBus platform skip), repository lint. A live two-client contention test is included in `postgres-queue.test.ts` and runs in CI with PostgreSQL 16; this Windows workspace has no local PostgreSQL DSN.

# 2026-09-17 — cost dispatch safety slice

- Hardened `@aqa/cost` with validated non-negative budgets/token counts, a fail-closed `assertCanDispatch()` boundary, and an explicit irreversible-in-instance `halt(reason)` kill switch. Unknown model pricing remains blocked and no provider call is counted when admission rejects it.
- Evidence: cost package typecheck and 8/8 tests; repository lint. Runtime worker integration, distributed halt persistence, provider reconciliation and auditable `budget_exceeded` events remain open.

# 2026-09-17 — interoperable agent skill rendering

- Updated Claude, Codex, Gemini and Copilot adapters to render the standard directory form `<skills-root>/<skill-name>/SKILL.md` instead of a flat `aqa-*.md` file. Added a contract test that validates the path and frontmatter for every target.
- This improves discovery compatibility but does not prove every installed host version discovers the files; host-version installation tests remain a separate complete-journey gap.

# 2026-09-17 — OTLP trace export slice

- Added a bounded `OtlpHttpSpanExporter` with OTLP/HTTP JSON payloads, explicit flush, failed-batch retry, queue limits, endpoint validation and span-attribute redaction. It is injectable through `fetcher`, so tests do not require a Collector.
- Evidence: observability typecheck and 9/9 tests; repository lint. Timer/shutdown integration, Collector deployment, Prometheus metric wiring and dashboards remain open.

# 2026-09-17 — OWASP risk discovery slice

- Extended `aqa risk discover` with a deterministic ten-control OWASP baseline (`--method owasp`) covering access control, crypto, injection, design, configuration, dependencies, authentication, integrity, logging and SSRF. It uses the same schema validation, safe overwrite and scope tags as STRIDE.
- Evidence: kit typecheck, risk-discovery tests including the 10-risk OWASP map, and repository lint. FMEA, attack trees, source-aware analysis, LLM-assisted hypotheses and human approval/versioning remain open.

# 2026-09-17 — FMEA risk discovery slice

- Added `aqa risk discover --method fmea`, generating six bounded failure-mode hypotheses for ambiguous requirements, invalid input, dependency outage, concurrency races, configuration drift and detection gaps. Each has a stable ID, one invariant, framework tag, scope tag and schema validation.
- Evidence: kit typecheck, risk-discovery tests including the FMEA map, and repository lint. Attack trees, source-aware analysis, LLM-assisted hypotheses and human approval/versioning remain open.

# 2026-09-17 — attack tree methodology slice

- Added bounded AND/OR attack-tree contracts to `@aqa/methodology`: validation rejects duplicate IDs, malformed leaves, excessive depth and node counts; evaluation consumes only an explicit compromised-leaf set; `attackTreeForRisk()` creates an invariant-linked skeleton.
- Evidence: methodology typecheck and 12/12 tests; repository lint. Persistence/schema integration, graph visualization, source-aware derivation and human-reviewed attack paths remain open.

# 2026-09-17 — MFA enforcement slice

- Added `MfaPolicy`/`enforceMfa()` to `@aqa/auth`, optional `User.mfa_verified`, OIDC `amr` claim mapping (`mfa`, `otp`, `webauthn`, `hwk`) and session-manager enforcement before persistence. Policies can target all users or selected roles; missing proof fails closed.
- Evidence: auth typecheck and 12 tests (11 passed, one PostgreSQL session skip); repository lint. TOTP/WebAuthn enrollment, recovery codes, admin policy persistence and an external-IdP complete journey remain open.

# 2026-09-17 — SCIM provisioning boundary slice

- Added a tenant-bound SCIM 2.0 provisioner contract to `@aqa/auth` with create, replace, patch (`active`/`displayName`), deactivate, get and list operations. It validates email/userName, assigns least-privilege viewer by default, rejects cross-tenant reads and keeps persistence behind an injected directory.
- Evidence: auth typecheck and 14 tests (13 passed, one PostgreSQL session skip); repository lint. PostgreSQL tenant-aware user schema, bearer-token route exposure, PATCH filter semantics, SAML and complete IdP provisioning journey remain open.

# 2026-09-17 — tenant-aware user directory persistence

- Extended `StoreProvider.listUsers/upsertUser` with optional org/project scope. MemoryStore namespaces user IDs with the same safe scope key used by other resources; PostgresStore persists the scope columns and queries through the existing scoped record index. The server users projection and OIDC admin snapshot now preserve the authenticated organization/project boundary.
- Evidence: store 13/13 tests, store/server typechecks, server suite 109 passed plus one PostgreSQL EventBus skip, repository lint. Live PostgreSQL scoped-user round-trip remains CI evidence; SCIM bearer routes, audit events and legacy-user migration remain open.

# 2026-09-17 — SCIM HTTP journey slice

- Added `/scim/v2/Users` and `/scim/v2/Users/:id` GET/POST/PUT/PATCH/DELETE routes. Every route requires an injected dedicated bearer verifier and `x-aqa-org`; DELETE deactivates rather than destructively erases the directory record. The journey preserves SCIM `userName`, roles, active state and tenant isolation.
- Complete HTTP evidence: server suite 111 tests (110 passed, one PostgreSQL EventBus skip), including unauthorized access, create, patch, list, cross-org denial and soft-delete; store build/typecheck and repository lint pass. SCIM token rotation/audit events, RFC filter pagination, SAML and live PostgreSQL SCIM round-trip remain open.

# 2026-09-17 — ecommerce tender and promotion integrity slice

- Added provider-neutral commerce contracts for exact split-tender reconciliation across card, gift-card and store-credit instruments, including currency and duplicate-tender guards. Added commit-time promotion validation for currency, expiry and redemption limits.
- Evidence: `@aqa/commerce` typecheck and 15/15 tests; repository lint and `git diff --check` pass. Durable atomic redemption, provider settlement, gift-card locking, tax treatment and financial reconciliation remain open.

# 2026-09-17 — SCIM query and pagination boundary

- Added optional query parameters to the API request contract and wired SCIM `filter`, `startIndex` and `count` to a tenant-bound ListResponse. The endpoint now reports total results before pagination and preserves the existing dedicated bearer authorization.
- Evidence: server typecheck, 111 tests (110 passed, one PostgreSQL EventBus skip), repository Biome check and `git diff --check` pass. Complex SCIM filter grammar, token rotation/audit events and live PostgreSQL provisioning remain open.

# 2026-09-17 — repository regression gate

- Ran the workspace gates after the enterprise slices: typecheck passed, `bun test` passed with 490 tests and 4 environment-dependent PostgreSQL skips, and the documentation plus workspace build passed.
- At that point the build still reported two known warning classes: the admin SPA emitted a 578.94 kB minified chunk and the CJS CLI reported `import.meta` compatibility warnings. The latter was resolved in the follow-up CJS bundle runtime-path slice below; the chunk-size warning remains.

# 2026-09-17 — CJS bundle runtime path hardening

- Removed ESM-only `import.meta` path resolution from the CLI run/admin commands. Runtime assets now resolve from the CJS entrypoint or recognized direct command path, with bounded package-relative fallback.
- Evidence: kit typecheck and 121/123 tests passed (2 symlink-capability skips); the rebuilt bundle emits no `import.meta` warning, contains no `import.meta` token, and completed a real temporary-project journey (`init` → `run`, 2 scenarios, 2 findings). The follow-up bundle suite now covers the real admin process health endpoint; the admin SPA chunk remains 578.94 kB.

# 2026-09-17 — bundled admin process journey

- Added a process-level test that starts the published CJS bundle, waits for `/api/healthz`, validates the JSON response, and terminates the child process in a `finally` block. This closes the prior asset-resolution smoke gap without claiming full authenticated UI coverage.
- Evidence: kit typecheck and 122/124 tests passed (2 symlink-capability skips); the real bundled admin health journey passed.

# 2026-09-17 — SCIM token lifecycle slice

- Added `ScimTokenManager` with opaque high-entropy issuance, hash-only persistence, tenant-bound constant-time verification, expiry, revoke/rotate and injected audit events. Rejected attempts are classified without recording bearer material.
- Evidence: auth typecheck and 14/15 tests (one PostgreSQL session skip), repository Biome check and diff check. Secret-manager wiring, atomic durable rotation, rate limiting and HTTP administration remain deployment work.

# 2026-09-17 — k6 performance summary ingestion

- Added bounded ingestion for k6 JSON summaries. p95 latency is preserved as duration evidence; request-error and check rates become explicit failed records, with stable fingerprints and fail-closed malformed-input handling.
- Evidence: ingest typecheck and 6/6 tests; repository Biome check and diff check pass. Threshold-policy evaluation, Locust ingestion and live performance execution remain open.

# 2026-09-17 — Locust performance summary ingestion

- Extended the performance ingestion boundary with Locust JSON statistics: request method/name, p95 latency, request/failure counts, stable fingerprints and bounded worker-error warnings. Non-negative numeric validation fails closed.
- Evidence: ingest typecheck and 8/8 tests; repository Biome check and diff check pass. Threshold-policy evaluation and live performance execution remain open.

# 2026-09-17 — SAML assertion validation boundary

- Added a provider-neutral SAML login boundary. An injected maintained XML signature/parser adapter feeds exact issuer/audience, required identity, time-window, atomic replay-claim and least-privilege role validation; no hand-written XML crypto is shipped.
- Evidence: auth typecheck and 16/17 tests (one PostgreSQL session skip); repository Biome check and diff check pass. Real IdP metadata/certificate rollover, durable replay storage and external SAML HTTP journey remain open.

# 2026-09-17 — DR and restore operational contract

- Added `docs/operations/dr-runbook.md` with approved RPO/RTO inputs, Postgres/WAL and artifact-store backup contract, isolated restore sequence, digest/tenant/queue checks, quarterly drill criteria and explicit infrastructure boundary. Added ADR-052.
- Evidence: documentation is present and scoped honestly; no live provider backup/restore was claimed. A real drill with KMS, WAL/PITR, object retention and measured RTO/RPO remains required.

# 2026-09-17 — sandbox output bound

- Added a combined stdout/stderr byte cap to `ContainerSandbox`, propagated through the executor, with child termination and explicit fail-closed result when exceeded. This closes an unbounded-memory path not covered by call count or timeout limits.
- Evidence: sandbox typecheck and 11/11 tests; repository Biome check and diff check pass. Real OCI fault/output stress and VM-level hostile-tenant isolation remain deployment evidence.

# 2026-09-17 — Helm image digest policy

- Added optional OCI digest rendering and fail-closed `requireDigest` switches for server and runner images. Operator docs now state that production must pin digests and retain SBOM/provenance evidence; tag defaults remain development-only.
- Evidence: chart/value/template diff validated by repository lint and diff check. Live `helm template`/upgrade against a cluster remains an infrastructure gate.

# 2026-09-17 — consolidated regression gate after enterprise slices

- Workspace typecheck, test and lint completed after SAML, k6, DR, sandbox and Helm changes: 498 tests passed, 4 PostgreSQL integration tests skipped because no DSN was configured, and 0 failures. Helm render was not available locally because the `helm` executable is not installed; this remains an explicit deployment gate.

# 2026-09-17 — admin risk coverage projection

- Added the `Risk coverage` admin screen and navigation entry. Mock mode renders explicit covered/partial/stale evidence states; live mode reads the tenant-scoped `/api/risk-coverage` projection, exposes drift alerts, and links each row back to the risk editor.
- Added a Playwright journey covering navigation, table rendering and representative coverage states. Admin typecheck and the focused Playwright test passed (1/1). Full workspace regression remains the next gate; the page does not claim live authenticated browser coverage without a configured server/identity provider.

# 2026-09-17 — explicit performance threshold policy

- Added numeric measurement retention to k6/Locust ingestion and a separate `evaluatePerformanceThresholds` boundary for p95, failure-rate and check-rate gates. Parsing remains evidence-only; policy now produces deterministic violations without mutating imported records.
- Evidence: ingest test 10/10; workspace typecheck, 502 tests passed, 4 PostgreSQL integration tests skipped without DSN, lint and diff-check passed. Live load execution and CI artifact wiring remain open.

# 2026-09-17 — CLI performance ingestion wiring

- Extended `aqa ingest` to accept k6 and Locust JSON summaries, preserving the same bounded/redacted artifact path and normalized report contract used by JUnit/SAST. Added a CLI-boundary test for both frameworks.
- Evidence: workspace typecheck, full workspace test gate passed (506 tests, 4 PostgreSQL skips, 0 failures), lint and diff-check passed. Threshold-file CLI flags and live CI gate enforcement remain separate follow-up work.

# 2026-09-17 — CLI performance threshold gate

- Added `aqa ingest k6|locust <file> --threshold-file <policy.json>`. The report remains the primary redacted evidence artifact; the numeric policy and structured violations are persisted in a separate threshold artifact. A failed threshold returns exit code 2 while ingestion itself remains recorded, making CI behavior explicit and inspectable.
- Evidence: kit suite 124 passed, 2 platform symlink skips; root lint and diff-check pass. CI workflow wiring and live load execution remain open.

# 2026-09-17 — CI performance threshold journey

- Added a CI step to the existing built CLI smoke job. It feeds a non-secret k6 JSON fixture and policy into the published CJS bundle, asserts the expected gate exit code `2`, and checks that the separate threshold artifact was written. This proves CI wiring without pretending to execute a real load generator.
- Evidence: workflow diff is syntactically scoped to the existing `e2e-cli` build job; local workspace build passed (admin chunk-size warning remains non-fatal). A GitHub Actions run is required for authoritative hosted-runner evidence.

# 2026-09-17 — k6 threshold semantic correction

- Corrected the k6 adapter so `http_req_failed.rate` normalizes to `failure_rate` and `checks.rate` to `check_rate`; the prior generic `rate` measurement could make those explicit policies silently pass.
- Evidence: ingest suite 11/11, workspace lint and diff-check pass. The CLI/CI journey now exercises the same normalized measurement contract.

# 2026-09-17 — OTLP exporter lifecycle hardening

- Added serialized flushes, stoppable bounded auto-flush and `shutdown()` drain semantics to `OtlpHttpSpanExporter`. Failed deliveries remain queued; shutdown fails if the bounded queue cannot drain instead of silently dropping telemetry.
- Evidence: observability suite 11/11, workspace lint and diff-check pass. Server/runner boot wiring to a configured Collector and deployed Collector availability remain environment work.

# 2026-09-17 — SCIM bearer boot integration

- Added the standard `Bearer <token-id>.<secret>` verification helper and wired `ScimTokenManager` into `aqa admin` as an explicit option. The admin HTTP server now delegates `/scim/v2/*` routes to the API (the previous static-only path made the tested SCIM routes unreachable from the bundled server).
- Evidence: auth 17 passed/1 PostgreSQL skip; kit 125 passed/2 platform skips; the real boot test covers unauthorized and authorized SCIM list requests, with lint/typecheck path green. Durable token storage and rate limiting remain deployment work.

# 2026-09-17 — durable SCIM token store

- Added `PostgresScimTokenStore` with serialized schema migration, hash-only records, tenant/index support, expiry cleanup and explicit close. Helm now maps `AQA_SCIM_TOKEN_DSN` in all PostgreSQL modes, and the CI Helm assertions cover the new production wiring.
- Evidence: auth typecheck and 17 passed/2 environment skips (the new PostgreSQL round-trip is skipped without DSN); lint and diff-check pass. The hosted PostgreSQL job must execute the round-trip before claiming durable production evidence; atomic rotation/rate limiting remain open.

# 2026-09-17 — durable SAML replay guard

- Added `PostgresSamlReplayGuard` with serialized migration, expiry index and atomic single-claim semantics. The existing SAML boundary can now use a durable replay store without weakening its maintained signature-verifier adapter boundary.
- Evidence: auth suite 17 passed/3 PostgreSQL-dependent skips without DSN, typecheck and lint pass. The hosted PostgreSQL job now invokes the combined SCIM/SAML persistence contract; real IdP metadata/certificate rollover and HTTP login wiring remain open.

# 2026-09-17 — post-identity regression gate

- Workspace typecheck, full Bun suite and lint completed after durable SCIM/SAML, OTLP and performance changes: **509 passed, 6 PostgreSQL-dependent skips, 0 failures across 51 files**. `git diff --check` also passes. The six skips are now explicitly named: OIDC session, SCIM token, SAML replay, EventBus, queue idempotency and quota concurrency.
# 2026-09-17 — MFA enrollment and recovery lifecycle boundary

- Added `MfaLifecycle` with generated TOTP enrollment material, `otpauth` URI, confirmation before activation, protected-secret injection, and one-time recovery-code consumption. Raw TOTP secrets and recovery codes are never persisted by the lifecycle; production must provide a KMS/Vault-backed protector and durable store.
- Added `PostgresMfaCredentialStore` with idempotent migration and composite tenant/user key; the store persists only protected secret material and recovery-code hashes.
- Evidence: auth build/typecheck, lifecycle tests 2/2, PostgreSQL contract 1 skip without DSN, repository lint and diff-check pass. Provider-backed secret protection, rate limiting/audit integration and WebAuthn remain open deployment work.
# 2026-09-17 — fail-closed execution versus assertion outcomes

- Separated probe execution state from oracle assertion state. Missing drivers, transport errors and cleanup failures now produce `execution_status=failed`, block `aqa run`, and do not create security findings. `aqa run` records bounded execution-error samples in `run_finished`; success fixtures inject an explicit probe driver instead of relying on an implicit no-op.
- Evidence: runner/kit journey tests 36/36 and pack-scaffold integration updated; full regression pending after this increment. This closes the false-green boundary but does not yet provide browser/SQL/shell drivers for every pack.
# 2026-09-17 — shared browser/backend audit verifier

- Added a runtime-neutral canonical JSON implementation and a WebCrypto-only `@aqa/compliance/browser` verifier. The admin audit viewer now consumes that package boundary instead of carrying a second hash implementation; prefix verification supports animated progress while rejecting tampered, reordered or partial chains.
- Evidence: compliance browser/node contract 8/8, full workspace typecheck and lint, admin production build passed. The admin bundle still reports the existing non-fatal chunk-size warning; WORM storage, signed checkpoints and completeness attestations remain separate operational controls.
# 2026-09-17 — typed oracle-to-probe references

- Added optional `oracle.probe_id` with Scenario cross-field validation for unique step IDs and existing referenced steps. Runtime evaluation scopes the oracle to that observation and fails closed when the reference is missing; legacy scenarios without the field remain compatible.
- Evidence: schema/runner targeted tests 41/41 after the new contracts, typecheck and lint pass. Existing legacy scenarios still use fallback semantics until packs are migrated to explicit references.
# 2026-09-17 — first-party pack oracle migration

- Migrated all first-party scenario packs with oracle steps to explicit `probe_id` references (API, web UI and LLM-agent packs). The legacy fallback remains only for third-party/older packs and is now visible as a migration concern rather than the default first-party contract.
- Evidence: pack YAML remains schema-loadable and the full regression is the authoritative gate after this change.
# 2026-09-17 — full pack content integrity

- Added optional `signing.content_sha256`, a deterministic digest over the unsigned canonical manifest plus every regular pack file. Symlinks and unsupported file types fail closed. `aqa run` verifies this digest after loading a pack and refuses tampered scenario/probe content before execution.
- Evidence: pack-scanner/CLI targeted tests 37/37, workspace typecheck and lint pass. Existing packs without `content_sha256` remain integrity-unpinned until a signing pipeline emits and verifies the field; Sigstore keyless publisher identity remains open.
# 2026-09-17 — Sigstore bundle verification boundary

- Added real Sigstore bundle verification through the maintained `sigstore` JavaScript client, with explicit certificate identity, OIDC issuer and transparency-log threshold policy. Server pack imports now reject declared bundles when no operator policy is configured and fail closed on malformed or unverifiable bundles.
- Evidence: scanner/server targeted tests 112/112, pack-scanner/server builds, workspace lint/typecheck pass. No live Fulcio/Rekor bundle was claimed in local evidence; CI must provide a real signed bundle journey before marking keyless production trust complete.

# 2026-09-17 — optional Playwright dependency bundle regression

- Hosted CI exposed a real packaging regression: the static Playwright import made the CLI bundle resolve optional browser internals (`chromium-bidi`) even for HTTP-only runs. The driver now loads Playwright dynamically only when a browser journey is instantiated; injected browser factories remain available for deterministic tests.
- Evidence: runner build/typecheck, runner tests **38/38**, kit build (including CLI bundle) and kit typecheck pass locally; `git diff --check` passes. Live Chromium installation and a hosted browser journey remain open deployment evidence.

# 2026-09-17 — profile wall-clock budget enforcement

- `aqa run` now enforces `profile.budget_minutes` at the scenario scheduler boundary. Once the deadline is reached, remaining scenarios are recorded as `not_run` with `reason: budget_exceeded`, the run emits bounded budget metadata and returns `ok: false`; partial coverage can no longer greenlight a gate. The clock is injectable only for deterministic embedding/tests and defaults to `Date.now`.
- Evidence: kit build/bundle, typecheck and `run-cmd` suite **30 passed, 1 explicit platform skip**. Hard cancellation of an already-running provider/browser request and LLM dollar/token budgets remain separate work.

# 2026-09-17 — finding status transition enforcement

- Moved finding status-transition validation to the shared schema/store write boundary. No-op and illegal transitions now fail with `409 INVALID_TRANSITION` at the API, preserve the original finding and append no audit event. Memory and PostgreSQL adapters both validate and parse the resulting finding, so callers cannot bypass the API contract through a direct store call.
- Evidence: server + store builds, **115 tests passed**, repository diff check passed. A full PostgreSQL transition round-trip remains hosted evidence when the CI DSN is available.

# 2026-09-17 — canonical budget state projection

- Extended the shared run-state derivation so `budget_exceeded: true` is preserved as the terminal `budget_exceeded` state in reports and admin projections, while execution/replay/canonical artifact errors remain fail-closed. This prevents a governed timeout from being flattened into an indistinguishable generic failure.
- Evidence: schemas build and validator suite **35 passed**; generated schema artifacts remain valid and `git diff --check` passes.

# 2026-09-17 — risk-map resolution in real scenario execution

- `aqa run` now loads `.aqa/risk-map.yaml`, ingests validated risk catalogs declared by selected packs, rejects scenarios with unresolved `risk_refs` as coverage errors, and passes the resolved risk into the runner. Findings derive `risk_id` and severity from that declaration instead of hard-coding `high`.
- Evidence: runner + kit build/bundle/typecheck, **47 targeted tests passed** with one explicit symlink-capability skip. The default scaffold remains intentionally minimal; projects must add risks for custom scenarios, while first-party packs provide their own risk catalog files.

# 2026-09-17 — risk catalog path hardening

- Applied the same realpath containment rule used for scenario files to pack-declared risk catalogs, rejecting symlinks that escape the pack root before parsing or execution.
- Evidence: kit build/bundle and `run-cmd` suite **30 passed**, with the existing explicit platform symlink skip.

# 2026-09-17 — HTTP dispatch policy hardening

- Hardened the real HTTP probe boundary: configured origins are normalized and validated, credential-bearing base/target URLs are rejected, redirects are never followed automatically, and redirect targets are checked against the same allowlist before being reported. Private origins remain usable only when explicitly allowlisted.
- Evidence: runner build and **18 tests passed**, including credential and off-origin redirect denial. DNS pinning/rebinding defense and browser network interception remain separate deployment controls.

# 2026-09-17 — browser network allowlist enforcement

- Playwright contexts now install a route-level network policy before the first page is created. Every HTTP(S) request is checked for credentials and an allowlisted origin; non-HTTP schemes and off-origin requests are aborted. This covers redirects and subresources that structured action URL validation cannot see.
- Evidence: runner build and **18 tests passed**, including an injected off-origin browser request that is aborted. Real Chromium/provider redirect evidence remains a hosted deployment journey.

# 2026-09-17 — tenant-scoped durable job cancellation

- Added `cancelled` as a terminal queue state in Memory and PostgreSQL adapters. `POST /api/runs/:id/cancel` requires tenant scope, records a bounded reason, clears the lease token and publishes `run.cancelled`; late worker ACKs are fenced and cross-tenant cancellation is indistinguishable from not-found.
- Evidence: server build, **112 tests passed** across API and queue suites. This is cooperative cancellation state: a worker already executing must observe the cancelled job and abort its driver; no false claim of process interruption is made.

# 2026-09-17 — cooperative probe cancellation contract

- Extended the runner driver contract with an optional `AbortSignal`. `runScenario` forwards the worker/orchestrator signal to the selected probe runner, and the HTTP driver propagates it to `fetch` while removing its listener on completion. An aborted request is an execution failure, therefore it cannot produce a security finding.
- Evidence: runner build, runner typecheck, **19 tests passed**, and `git diff --check` passed. Shell, SQL, PostgreSQL and Playwright drivers still need signal-aware cancellation; there is still no executable server worker that observes queue cancellation and interrupts an in-flight job.

# 2026-09-17 — cooperative queue worker runtime

- Added `RunnerWorker`, a provider-neutral worker loop that dequeues a leased job, polls the queue for cancellation, propagates an `AbortSignal` to the handler, ACKs only successful non-cancelled work, and records bounded single-line failure reasons. Added `get(id)` to both queue adapters so cancellation observation works with memory and PostgreSQL implementations.
- Evidence: server build, **120 tests passed**, including in-flight cancellation and bounded failure tests, and `git diff --check` passed. The worker handler is intentionally injected: real payload-to-`aqa run` orchestration, lease heartbeats for long jobs, runner authentication/identity, and live PostgreSQL worker evidence remain open.

# 2026-09-17 — worker lease heartbeat and fencing

- Added `renew(id, lease_token)` to memory and PostgreSQL queues. `RunnerWorker` renews the lease while a handler is running and aborts with `lease_lost` if the token is fenced or the job leaves `in_flight`; it never converts a lost lease into an ACK or a false failure write.
- Evidence: server build, **122 tests passed**, including current-token renewal and lease-loss fencing, and `git diff --check` passed. Live PostgreSQL renewal/reconnect evidence and production heartbeat metrics remain open.

# 2026-09-17 — shell driver cooperative cancellation

- The controlled shell driver now accepts the runner `AbortSignal`, rejects an already-cancelled probe before spawn, kills the child process on cancellation, removes its listener, and reports cancellation as execution error. This preserves the no-finding rule for interrupted execution.
- Evidence: runner build, **20 tests passed**, including an actual long-running child cancellation, and `git diff --check` passed. SQL cancellation depends on the injected adapter contract; Playwright/provider-specific cancellation and live sandbox process-tree cleanup remain open.

# 2026-09-17 — queue worker wired to the real kit orchestrator

- Added `makeRunJobHandler` in `@aqa/kit`. It maps a validated queue payload to the fixed operator-configured project root and the canonical `runRun` implementation, forwards the worker `AbortSignal`, and rejects invalid profile/seed types. `RunOptions` now stops scheduling after cancellation and returns `ok: false` with explicit cancellation evidence.
- Evidence: kit build/bundle, typecheck, **56 filtered tests passed**, and `git diff --check` passed. A live server-to-worker HTTP process journey, artifact publication through a remote store, runner identity enforcement and multi-process PostgreSQL evidence remain open.

# 2026-09-17 — real queue-to-HTTP run journey

- Added `makeKitWorker`, the official composition of `RunnerWorker` and the canonical kit handler. The integration journey now enqueues a real job, dequeues it through the worker, executes a local HTTP probe through `runRun`, writes the real `.aqa/runs` artifacts, and ACKs the queue job.
- Evidence: kit build/bundle, typecheck, targeted journey tests **3/3 passed**, and `git diff --check` passed. This is in-process MemoryQueue evidence; a separate-process PostgreSQL/remote-artifact/runner-auth journey is still required for production sign-off.

# 2026-09-17 — durable queue runner authentication fail-closed

- `runAdmin` now refuses to boot with `AQA_QUEUE_DSN` unless a dedicated `runnerAuthorize` callback or `AQA_RUNNER_TOKEN` is configured. The environment-token fallback accepts only `Bearer <token>` and compares SHA-256 digests with `timingSafeEqual`; the raw token is never logged or persisted.
- Evidence: kit build/bundle, typecheck, **14 admin tests passed**, and `git diff --check` passed. OIDC/mTLS/short-lived runner identity and rotation remain the production-grade credential path; the static token is a bounded bootstrap fallback.

# 2026-09-17 — Playwright cooperative cancellation

- Browser probe runners now accept the worker signal, reject pre-cancelled probes, close the active page on abort, re-check cancellation after browser awaits, and remove listeners in `finally`. Cancellation is reported as execution failure and cannot become an oracle finding.
- Evidence: runner build/typecheck, **21 tests passed**, including active-page closure, and `git diff --check` passed. Native provider cancellation, browser context/process cleanup and hosted Chromium evidence remain open.

# 2026-09-17 — SQL cooperative cancellation boundary

- SQL runner adapters now receive the worker `AbortSignal`; pre-cancelled queries are rejected and cancellation is rechecked after adapter completion. PostgreSQL preserves its bounded read-only transaction and statement timeout, then reports cancellation if the signal arrived; the underlying driver has no claimed native abort primitive.
- Evidence: runner build/typecheck, **22 tests passed**, including signal propagation to an injected adapter, and `git diff --check` passed. Native PostgreSQL query cancellation, live DSN evidence and resource cleanup remain open.

# 2026-09-17 — LLM budget enforcement at adapter boundary

- Added `BudgetedLlmAdapter`: it performs pre-dispatch admission using a configurable token estimate, charges authoritative provider usage after the call, exposes a budget snapshot, and blocks subsequent dispatches once the USD budget is exhausted. Unknown model pricing remains fail-closed through `BudgetTracker`.
- Evidence: LLM adapter build and **15 tests passed**, including no-dispatch admission denial and post-call exhaustion. Default character-based estimation is conservative scaffolding; production should inject versioned tokenizer/pricing data and persist aggregate usage across workers/projects.

# 2026-09-17 — distributed LLM budget reservations

- Added `BudgetLedger` with atomic Memory and PostgreSQL implementations. Reservations are keyed by org/project/run scope, account for in-flight estimated spend, and settle idempotently against actual usage. `BudgetedLlmAdapter` optionally uses the ledger, preventing concurrent workers from dispatching past a shared budget.
- Evidence: cost build and **9 tests passed**, LLM adapter build and **16 tests passed**, including concurrent shared-ledger admission. PostgreSQL live concurrency/settlement evidence, durable budget configuration APIs, pricing version distribution and reconciliation remain open.
- Hardening follow-up: PostgreSQL ledger migrations now use an advisory lock and existing keys reject changed budget limits, preventing replica configuration drift.

# 2026-09-17 — orphaned LLM budget reservation reaper

- Added TTLs to budget reservations and `reapExpired()` to Memory/PostgreSQL ledgers. PostgreSQL reclaims expired rows with `FOR UPDATE SKIP LOCKED`, releases the reserved estimate and marks the reservation settled; repeated cleanup is safe.
- Evidence: cost build/typecheck and **10 tests passed**, including simulated worker crash recovery. Production still needs a scheduled reaper/metric/alert and a live PostgreSQL multi-client recovery journey.

# 2026-09-17 — reusable budget reaper scheduler

- Added `BudgetReaper`, a validated long-lived scheduler around `reapExpired()`. It prevents overlapping ticks, exposes a deterministic `runOnce()` for job schedulers/tests, supports idempotent start/stop and routes failures through an injected callback.
- Evidence: cost build/typecheck and **11 tests passed**, including scheduled lifecycle behavior. Kubernetes CronJob/systemd wiring, metrics and alerts remain deployment work.

# 2026-09-17 — Helm budget reaper deployment wiring

- Added the `aqa-budget-reaper` one-shot server entrypoint and an optional Helm `CronJob` with `concurrencyPolicy: Forbid`, bounded retry history, non-root/read-only security context and DSN-from-Secret wiring. Enabling the chart without a PostgreSQL Secret fails at template time; the binary fails closed without `AQA_BUDGET_LEDGER_DSN`.
- Evidence: server build, typecheck, **122 tests passed**, CLI missing-DSN negative check, and CI Helm lint/template assertions updated. Helm is not installed in this Windows workspace, so rendered-chart evidence remains CI-authoritative.

# 2026-09-17 — versioned pricing catalog identity

- Added `PricingCatalog` parsing with schema/version/effective timestamp validation, deterministic model ordering and SHA-256 identity. `BudgetTracker` can consume the catalog and exposes `pricing_version`/`pricing_sha256` in every snapshot, making cost evidence attributable to a precise listino.
- Evidence: cost build/typecheck and **12 tests passed**, including digest mismatch rejection. Signed catalog distribution, admin configuration/rotation and durable usage records carrying the catalog identity remain open.

# 2026-09-17 — durable LLM usage attribution

- Extended the shared budget settlement contract so each completed reservation can persist provider model, authoritative input/output token counts, actual USD and the applied pricing catalog version/hash. PostgreSQL migration is additive and safe for existing reservation rows; orphan reaping remains metadata-free by design because no provider call completed.
- Evidence: cost build/typecheck with **12 tests passed** and LLM adapter build with **17 tests passed**, including catalog identity propagation at settlement. Live PostgreSQL schema migration/concurrency and an operator-facing usage query remain deployment/integration evidence.

# 2026-09-17 — strict run request boundary

- Added the shared `RunRequest` schema and applied it before queue insertion. The public API now accepts only the supported `profile` and bounded deterministic `seed`; tenant org/project are server-derived and arbitrary fields such as filesystem roots are rejected before durable queue persistence.
- Evidence: schemas/server build, server **123 tests passed**, including an explicit rejection of an unsafe `root` field. The worker still resolves the project root from operator configuration, never from the request payload.

# 2026-09-17 — pricing timestamp hardening

- Tightened pricing catalog validation to require bounded catalog versions, non-empty model names and canonical ISO UTC timestamps (`Z`), preventing timezone/date-only ambiguity in cost evidence.
- Evidence: cost build/typecheck and **12 tests passed**, including rejection of a date-only effective timestamp.

# 2026-09-17 — tenant-scoped runner authorization

- Runner authentication can now return explicit `org`/`project` scopes. Memory and PostgreSQL dequeue apply those scopes before leasing; ACK/fail re-read the job and hide cross-tenant attempts as not-found. Boolean authorizers remain compatible as an intentionally unscoped bootstrap path.
- Evidence: server build/typecheck and **125 tests passed**, including scoped dequeue and cross-tenant ACK denial. Live PostgreSQL scoped dequeue and production mTLS/OIDC claim issuance remain deployment evidence.

# 2026-09-17 — executable scoped worker deployment

- Added the real `aqa worker` entrypoint: it requires a PostgreSQL queue DSN, operator-owned project root and explicit runner scopes, composes `RunnerWorker` with the canonical kit handler, handles SIGTERM/SIGINT and closes the queue cleanly. Helm can now enable the worker StatefulSet with Secret-backed DSN and scoped environment configuration; default scaffold remains disabled until configured.
- Evidence: server/kit builds and worker configuration tests **3/3 passed**. Helm is not installed in this Windows workspace; CI render/lint is authoritative for the chart path.

# 2026-09-17 — runner scope parser fail-closed hardening

- Rejected malformed `org/` scope entries; only `org/project` and explicit `org/*` are accepted, preventing an incomplete deployment value from becoming an unintended organization-wide permission.
- Evidence: kit build/typecheck and worker configuration tests **3/3 passed**.

# 2026-09-17 — ecommerce agent tool authorization contract

- Added `CommerceToolPolicy` for EC-10: read tools require an allowlist and same-tenant/customer target; write/financial tools require a single-use human approval bound to call ID, tenant, customer, cart revision, exact minor-unit total/currency and expiry. Prompt text or agent output cannot self-approve a mutation.
- Evidence: commerce build/typecheck and **21 tests passed**, including cross-tenant denial, missing approval, stale/expired approval and replay rejection. Durable approval storage, provider atomicity and a live merchant tool gateway remain required integration evidence.

# 2026-09-17 — durable commerce approval consumption

- Added `CommerceApprovalLedger` with in-memory and atomic PostgreSQL implementations. `CommerceToolPolicy.authorizeAsync()` claims an approval exactly once; when a durable ledger is configured, synchronous authorization fails closed instead of using process-local replay state.
- Evidence: commerce build/typecheck and **22 tests passed**, including duplicate approval consumption. Live PostgreSQL concurrency, approval issuance/audit and atomic merchant mutation still remain deployment evidence.

# 2026-09-17 — WebAuthn passkey lifecycle boundary

- Added `WebAuthnLifecycle` with HTTPS-origin validation, bounded random one-time challenges, user/origin/RP/credential binding, injected signature verification, monotonic-counter clone detection and explicit counterless-authenticator support. Exported the boundary from `@aqa/auth` and documented the production integration limits in ADR-117.
- Evidence: auth build/typecheck and **30 tests passed**, including replay, wrong-user/origin/credential, expiry, signature failure, counter rollback and counterless credentials. Durable challenge/credential stores, a maintained cryptographic verifier and a real browser/provider passkey journey remain open.

# 2026-09-17 — enterprise regression after WebAuthn increment

- Evidence: repository `typecheck`, **591 tests passed / 0 failed**, workspace build and Biome lint all passed locally. The local run has no `AQA_TEST_POSTGRES_DSN`, so PostgreSQL-dependent tests remain explicit non-evidence skips; GitHub CI run `35205836642` has PostgreSQL integration and Bun tests passed, while Node 22 and Build were still running at ledger update time. No Copilot review was requested or awaited per user instruction.

# 2026-09-17 — scoped runner JWT authentication

- Added `RunnerJwtAuthorizer` with an RS256-only trust boundary, exact issuer/audience, required expiry, optional bounded not-before, runner subject and strict `org/project` or explicit `org/*` scopes. `aqa admin` now wires the verifier from `AQA_RUNNER_JWT_PUBLIC_KEY`, `AQA_RUNNER_JWT_ISSUER` and `AQA_RUNNER_JWT_AUDIENCE`, rejecting partial configuration; static `AQA_RUNNER_TOKEN` remains an explicit bootstrap fallback.
- Evidence: auth build/typecheck and **33 tests passed**, kit typecheck and its **136 passed / 2 platform skips** suite passed, including partial JWT environment rejection. Live IdP token issuance/rotation, mTLS and multi-process server-to-worker JWT journey remain deployment evidence.

# 2026-09-17 — commerce ambiguous mutation boundary

- Added `CommerceMutationGate` for agentic commerce writes. It composes durable approval authorization with a provider executor and preserves the distinction between `committed`, `not_committed` and `unknown`; thrown/ambiguous provider outcomes never become a successful mutation or a safe retry. The executor contract requires merchant-side atomic revision/total/idempotency checks and reconciliation.
- Evidence: commerce build/typecheck and **23 tests passed**, including the ambiguous timeout path and approval replay denial. Real payment/merchant transaction atomicity, provider idempotency retention and fault-injected sandbox journeys remain deployment evidence.

# 2026-09-17 — signed LLM pricing catalog provenance

- Added Ed25519 signing and trust-map verification for canonical versioned pricing catalogs. Budget configuration can now reject unknown operator keys, algorithm changes and catalog tampering before admission; the catalog digest/version remain the reproducibility identity.
- Evidence: cost build/typecheck and **13 tests passed**, including trusted-key verification, tampering and unknown-signer rejection. KMS/Vault key lifecycle, admin distribution/rotation and provider invoice reconciliation remain deployment evidence.

# 2026-09-17 — full workspace regression after enterprise slices

- Evidence: repository typecheck, **599 tests passed / 0 failed**, and Biome lint passed locally after JWT runner, commerce mutation, signed pricing catalog, durable WebAuthn and CORS changes. PostgreSQL-dependent branches remain explicit skips without `AQA_TEST_POSTGRES_DSN`; hosted CI remains authoritative for those live contracts and for Node 22/OCI/browser execution.

# 2026-09-17 — durable WebAuthn PostgreSQL stores

- Added multi-replica WebAuthn persistence: advisory-locked migrations, atomic one-time challenge consumption, user-bound credential reads and conditional monotonic-counter updates. Credential registration is explicit and does not persist private keys.
- Evidence: auth build/typecheck and **34 tests passed**, including a concurrent two-client counter contract (skipped without `AQA_TEST_POSTGRES_DSN`). The hosted PostgreSQL run must execute this new contract; real browser/provider ceremony and verifier integration remain open.

# 2026-09-17 — admin CORS and cross-origin mutation hardening

- Removed the wildcard CORS default from `aqa admin`. Cross-origin access is now opt-in through an explicit origin allowlist; allowed origins receive exact credentialed CORS headers, while disallowed preflights and state-changing requests return `403` before routing.
- Evidence: kit build and **137 tests passed / 2 platform skips**, including a real HTTP allowlist/preflight/mutation contract. CSRF token strategy, production reverse-proxy headers and live browser deployment remain separate controls.

# 2026-09-17 — CI regression fixes: CLI references and DLP-safe run IDs

- Fixed the CLI smoke fixture so its scenario risk/invariant references are backed by the generated project risk map; the smoke now validates the same resolution path as a real project.
- Fixed PAN redaction false positives for structured run/checkpoint identifiers whose timestamp digits happen to satisfy Luhn. Conventional contiguous/grouped card numbers remain redacted, while immutable artifact keys remain byte-stable.
- Evidence: `@aqa/observability` **15 passed**, `@aqa/kit` **140 tests / 138 passed / 2 platform skips**, and `bun run test:e2e-cli` **5/5 passed** locally. The fix is ready for the next hosted CI run; production browser/provider, live merchant/payment atomicity and durable deployment evidence remain open by design.

# 2026-09-17 — deterministic PostgreSQL concurrent status evidence

- Corrected the PostgreSQL store contract to model concurrent finding decisions as serialized optimistic conflicts: one or both transitions may commit according to lock order, while an invalid terminal-state transition is an explicit rejected operation rather than an unhandled test failure.
- Evidence: local workspace regression remains green; the hosted PostgreSQL contract had exposed this order-dependent assertion and the fix is queued for CI revalidation.

# 2026-09-17 — route-derived OpenAPI contract

- Added `GET /openapi.json`, generated from the concrete server route table so
  methods, paths, operation IDs, bearer security and permission metadata cannot
  silently drift from the running API. Added server route-count coverage and a
  real admin HTTP assertion for the published document.
- Evidence: server tests **124 passed**, kit tests **140 total / 138 passed / 2
  expected platform skips**, repository typecheck, Biome lint and diff checks
  passed locally. Generic transport schemas remain intentionally provisional;
  domain payloads must be connected to the versioned schemas package before
  declaring SDK-generation readiness.
- Next: wire the admin SPA to the stream and add reconnect/cursor semantics for
  multi-replica gaps.

# 2026-09-17 — tenant-scoped live event stream

- Implemented `GET /api/events/stream` in the admin Node adapter. It requires
  authenticated `runs:read`, an org scope, optional project scope, server-side
  event filtering, SSE reconnect hints, heartbeat comments, and cleanup on
  client disconnect. The framework-neutral route table exposes the same
  permission metadata and returns an explicit 501 in adapters without stream
  support.
- Evidence: real HTTP admin test passed with tenant-positive and tenant-negative
  events, initial SSE framing and reader cancellation; kit suite **141 total / 
  139 passed / 2 expected platform skips**, typecheck, Biome lint and diff
  checks passed locally.
- Remaining: validate the browser EventSource journey through a deployed
  reverse proxy and add replay/cursor semantics for reconnect gaps in
  multi-replica deployments.

# 2026-09-17 — browser-proven live event stream

- Replaced the admin's SSE-labelled simulation gap with a real `EventSource`
  connection when `VITE_AQA_SERVER_URL` is configured. The UI exposes
  connecting/connected/reconnecting state and the last received event, while
  durable API reads remain authoritative.
- Upgraded the ecosystem stack to use `MemoryEventBus`, a real SSE adapter and
  a causal post-subscription fixture event. The complete browser journey now
  proves the stream is opened and `run.requested` is rendered by the SPA.
- Evidence: ecosystem Playwright **3/3 passed**, admin typecheck/build,
  repository Biome lint and diff checks passed. Remaining: durable cursor/replay
  after reconnect and reverse-proxy deployment evidence.
- Next: add bounded replay/cursor semantics to the event bus and recovery
  refetches on stream reconnect.

# 2026-09-17 — AsyncAPI live event contract

- Added an AsyncAPI 3.0 document generated from the supported live event
  registry and exposed it from `GET /asyncapi.json`. It documents the
  tenant-scoped `BusEvent` envelope, `runs:read` permission, and the current
  run/finding notification types for SSE and future WebSocket adapters.
- Evidence: server contract suite passed with the AsyncAPI operation assertion,
  kit admin HTTP test verifies content type and event operation, repository
  typecheck/lint/diff checks passed. Durable replay/cursor semantics remain the
  next eventing increment.

# 2026-09-17 — OpenAPI domain schema references

- Upgraded the generated OpenAPI contract from generic request/response objects
  to versioned `@aqa/schemas` references for runs, run requests, findings,
  profiles, scenarios, risk maps, projects, notifications, agents and SSO
  configuration, with typed list/detail envelopes where the API already has a
  stable shape.
- Specialized endpoints that do not yet have a promoted domain envelope remain
  explicitly generic; this is a measured contract gap, not a false claim of
  complete SDK-generation readiness. Server tests **125 passed**, typecheck,
  lint and diff checks passed locally.

# 2026-09-17 — SSE reconnect projection recovery

- Added reconnect lifecycle handling to the admin `EventSource`: a recovered
  connection dispatches `aqa:live-reconnected`, and Runs/Findings refetch their
  tenant-scoped authoritative API projections. Received events dispatch the
  low-latency `aqa:live-event` refresh signal as well.
- Evidence: admin typecheck/build passed, ecosystem Playwright **3/3 passed**,
  repository lint and diff checks passed. Server-side durable cursors/replay and
  reverse-proxy fault-injection remain the next eventing evidence gap.

# 2026-09-17 — bounded durable event replay

- Added optional provider-neutral event replay with tenant/project scope and
  bounded limits. `MemoryEventBus` retains a deterministic 1,000-event history;
  `PostgresEventBus` persists events before `NOTIFY` in `aqa_live_events` and
  replays after a monotonic cursor.
- The SSE adapter subscribes before replay, deduplicates event IDs, emits
  `stream.gap` for expired cursors or replay failures, and keeps the existing
  authoritative reconnect refetch fallback.
- Evidence: server suite **126 passed**, kit suite **139 passed / 2 expected
  platform skips**, kit/server typecheck, repository lint and diff checks pass
  locally. PostgreSQL persistence/replay remains skipped locally without
  `AQA_TEST_POSTGRES_DSN`; CI/deployment evidence is still required.
- Next: add outbound webhook delivery with retry/DLQ semantics and define
  PostgreSQL event-log retention/pruning before production rollout.

# 2026-09-17 — outbound webhook foundation

- Added `@aqa/integrations` with a provider-neutral delivery state machine:
  stable delivery IDs, exact-body HMAC-SHA256 signing, bounded exponential
  retry with `Retry-After`, per-integration rate limiting and explicit DLQ after
  five attempts.
- Evidence: package tests **3 passed**, package typecheck, repository lint and
  diff checks pass locally. The implementation uses an injectable transport and
  memory queue; no external vendor or secret was contacted.
- Remaining before production integrations: secret manager integration,
  redacted audit/metrics, destination allowlisting and real provider journeys.

# 2026-09-17 — durable webhook queue

- Added `PostgresWebhookQueue` with `aqa_webhook_deliveries`, atomic
  `FOR UPDATE SKIP LOCKED` claims, lease fencing, retry/DLQ state and explicit
  `redrive(id)`. The queue stores only `secret_ref`; workers resolve the secret
  through an injected resolver before signing the exact body.
- Added an optional PostgreSQL integration contract that runs when
  `AQA_TEST_POSTGRES_DSN` is configured. Local evidence: package typecheck and
  three deterministic tests pass; the durable test is intentionally skipped
  without PostgreSQL credentials.
- Remaining: wire a secret-manager implementation and authenticated admin
  endpoint/metrics, enforce transport-level DNS/private-IP protections, and
  prove a real provider journey. Durable origin allowlisting is now enforced.

# 2026-09-17 — provider-neutral integration templates

- Added deterministic payload renderers for Slack, Teams Adaptive Cards, Jira
  issue creation and PagerDuty Events API. Payloads carry event metadata but no
  routing key, secret or credential; delivery remains owned by the signed,
  durable webhook queue.
- Evidence: integrations suite **5 pass** locally, package typecheck/lint and
  repository diff checks pass. No external provider was contacted.
- Remaining: secret-manager implementation, audit/metrics observer, transport
  DNS/private-IP enforcement and real provider journeys.

# 2026-09-17 — bounded webhook HTTP transport

- Added `HttpWebhookTransport`: send-time HTTPS allowlist validation, no
  redirects, bounded timeout, bounded response handling and `Retry-After`
  parsing. It is injectable and never contacts a vendor in unit tests.
- Evidence: integrations suite **6 pass**, package typecheck/lint and diff
  checks pass locally. DNS rebinding/private-IP protection remains explicitly
  delegated to a connection-aware egress proxy/runtime.
- Remaining: wire host metrics/log adapters, secret manager and production
  egress policy, then prove real provider journeys.

# 2026-09-17 — ecommerce fulfillment and RMA contracts

- Closed the documented ADR-020 ecommerce gap by adding versioned
  `FulfillmentSnapshot` and `ReturnRequestSnapshot` contracts plus shared
  invariants for order quantity, duplicate SKU, currency, tracking and
  shipped/delivered evidence.
- Evidence: `@aqa/commerce` suite **24 passed / 0 failed**, typecheck, lint and
  diff checks pass locally. This proves the domain contract only; real WMS,
  carrier, RMA approval and settlement journeys remain adapter evidence.
- Next ecommerce gaps: subscriptions, cancellations/chargebacks, loyalty and
  provider-backed fulfillment journeys, if required by the target merchant.

# 2026-09-17 — ecommerce subscriptions and chargebacks

- Added versioned `SubscriptionSnapshot` and `ChargebackSnapshot` contracts
  with invariants for billing period order, cancellation semantics, exact
  payment linkage, currency/amount bounds and dispute evidence deadlines.
- Evidence: `@aqa/commerce` suite **25 passed / 0 failed**, typecheck, lint and
  diff checks pass locally. No billing or dispute provider was contacted.
- Remaining: provider-backed subscription/dunning/dispute journeys and
  loyalty/cancellation adapters.

# 2026-09-17 — ecommerce loyalty ledger

- Added `LoyaltyAccountSnapshot` and `LoyaltyTransactionSnapshot` with exact
  balance reconciliation, duplicate transaction detection, sign invariants and
  negative-balance protection.
- Evidence: `@aqa/commerce` suite **26 passed / 0 failed**, typecheck, lint and
  diff checks pass locally. Provider redemption and durable ledger journeys
  remain adapter evidence.
- Remaining: real billing/dispute/loyalty providers, cancellation workflows and
  complete ecommerce journey coverage.

# 2026-09-17 — ecommerce cancellation contract

- Added `CancellationSnapshot` with explicit decision states, decision timing,
  exact order linkage and compensating `refund_id` evidence for paid orders.
- Evidence: `@aqa/commerce` suite **27 passed / 0 failed**, typecheck, lint and
  diff checks pass locally. Provider void/refund reconciliation remains
  adapter evidence.
- Remaining: provider-backed billing, disputes, loyalty, fulfillment and full
  external ecommerce journeys.

# 2026-09-17 — redacted webhook observability

- Added an optional `PostgresWebhookQueue` observer for attempt/outcome
  events. It exposes only stable delivery metadata and HTTP status, never URL,
  payload, secret or secret reference; observer failures are isolated from
  delivery.
- Evidence: integrations suite **5 pass**, package typecheck/lint and diff
  checks pass locally. PostgreSQL observer assertion runs with the existing
  `AQA_TEST_POSTGRES_DSN` contract in CI.
- Remaining: wire host metrics/log adapters, enforce transport DNS/private-IP
  protections and prove real provider journeys.

# 2026-09-17 — durable runner lease reaper

- Added `RunnerQueueLike.reapExpired()` to reclaim orphaned PostgreSQL leases
  independently of worker availability. Expired jobs below the retry limit are
  requeued; jobs at the limit become terminally failed; both paths clear the
  fencing token and return bounded counts only.
- Added `aqa-runner-reaper` plus an optional Helm CronJob with Secret-backed DSN,
  `Forbid` concurrency, non-root and read-only filesystem settings. ADR-152
  records the retry/idempotency boundary: queue recovery cannot compensate an
  already-executed external side effect.
- Evidence pending: local server typecheck/tests and Helm rendering; the live
  PostgreSQL crash/retry journey requires `AQA_TEST_POSTGRES_DSN`.

# 2026-09-17 — runner recovery network policy

- Extended the chart NetworkPolicy so in-cluster runners can reach the
  PostgreSQL subchart on TCP/5432 and the lease-reaper CronJob has a dedicated
  database-only egress policy. Managed PostgreSQL remains an operator input via
  `networkPolicy.runnerExtraEgressCidrs`; a DSN Secret cannot safely imply a
  Kubernetes network identity.
- Evidence: chart CI renders/lints the production-shaped deployment; live
  managed-Postgres connectivity remains deployment-specific.

# 2026-09-17 — authenticated Prometheus scrape boundary

- Wired the existing bounded `MetricsRegistry` into `aqa admin` through an
  injected `GET /metrics` endpoint. The endpoint is opt-in, emits only the
  registry's Prometheus-safe text, and requires `metricsAuthorize` before an
  off-loopback bind is allowed. Added ADR-153 and a real HTTP admin test.
- Evidence: kit typecheck, Biome and admin journey suite **140 passed / 2
  platform skips**. Prometheus deployment, alert rules and host metric
  instrumentation remain operator/application integration work.

# 2026-09-17 — example dependency security baseline

- Upgraded `examples/laravel-app` from the unlocked Laravel 11 constraint to
  Laravel 12.69.2 and committed the Composer lockfile. This removes the two
  runtime Dependabot advisories without suppressing Composer security policy.
- Evidence: `composer audit --locked` reports **no security vulnerability
  advisories**. The docs-site npm audit is also currently clean; GitHub's older
  default-branch alerts may take time to refresh.

# 2026-09-17 — bounded persistent queue priority

- Added optional run priority `-10..10` to the request/schema/API boundary and
  queue contracts. Memory and PostgreSQL queues lease higher priorities first,
  preserve FIFO ties, and PostgreSQL persists the value through an additive
  migration. ADR-155 documents that fairness/starvation SLOs are intentionally
  not inferred from priority alone.
- Evidence: server suite **131 passed / 0 failed**, server typecheck/Biome and
  generated JSON Schema pass locally. PostgreSQL ordering remains a hosted
  contract when `AQA_TEST_POSTGRES_DSN` is available.

# 2026-09-17 — PostgreSQL idempotency bootstrap race

- Hosted CI exposed a real multi-client migration race: two
  `PostgresApiIdempotencyStore` instances could concurrently create the table
  type despite `IF NOT EXISTS`, yielding a duplicate `pg_type` failure.
  Serialized table/index bootstrap now uses a PostgreSQL advisory lock with a
  guaranteed unlock. ADR-156 records the production-relevant fix.
- Evidence: failure reproduced from CI logs; local typecheck/tests remain green.
  The next hosted PostgreSQL run is required before marking the regression
  closed.

# 2026-09-17 — transaction-scoped migration locks

- Extended the race fix to the PostgreSQL runner queue and LLM budget ledger.
  All three adapters now run the complete DDL bootstrap and
  `pg_advisory_xact_lock` on the same transaction client. This closes the
  pooled-session hazard where a session lock could be acquired, DDL routed to
  another connection, or unlock issued against the wrong session.
- Evidence: code-level lock audit has no remaining session-scoped migration
  locks in the durable adapters. Local typecheck, Biome and package tests are
  still required; hosted PostgreSQL CI remains the authoritative concurrency
  proof.
