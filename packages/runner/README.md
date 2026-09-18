# @aqa/runner

Semantic agent evaluation is available through `evaluateAgentTrials()` and
`calibrateAgentJudges()`. The first applies an explicit multi-judge,
multi-trial policy and returns `inconclusive` for insufficient/disagreeing
evidence; the second computes Brier/ECE metrics on a reviewed gold corpus.
Both consume opaque scores and model identities, not private judge rationales.

`AgentTrajectoryStore` persists validated, digest-bound trajectory envelopes
with atomic writes, size bounds and immutable `(run_id, scenario_id)` keys.
Reads verify the digest before returning the snapshot.
`PostgresAgentTrajectoryStore` provides the same immutable contract across
worker replicas with atomic conflict handling and read-time invariant checks.
Production clients must provide a transaction primitive so schema bootstrap
can take a transaction-scoped advisory lock before DDL. The unsafe
non-transaction bootstrap switch exists only for injected test doubles and
must not be enabled for real PostgreSQL deployments. The CI PostgreSQL
integration job runs a two-instance contract when a test DSN is configured;
this does not replace production backup, PITR or restore drills.
Mount the production artifact domain on WORM/Object-Lock storage when legal
retention guarantees are required.

Orchestrator runner for `agentic-qa-kit`. Ships:

- **`RunLifecycle`** — state machine (pending → running → {succeeded, failed, aborted, budget_exceeded}).
- **`EventChainWriter`** — append-only `events.jsonl` writer. Each event computes
  `hash = sha256(prev_hash || canonical(event))`, giving the audit log SOC2-style tamper evidence.
  An optional `onEvent` observer exposes a non-blocking integration point for
  traces, metrics and event buses; observer failures never invalidate the
  persisted audit chain.
- **`makeBudgetEventSink`** — connects prompt-free accounting events from
  `@aqa/llm-adapters` to the same hash chain, preserving bounded usage/cost
  evidence without persisting prompts or completions.
- **`FindingsWriter`** — append-only `findings.jsonl` with in-run dedup on `(run_id, scenario_id, risk_id, severity)`.
- **`evaluateOracle`** + built-in `http_status` / `response_contains` / `response_not_contains` oracles.
- `response_contains` supports bounded JSONPath equality against a previous
  probe output (for example `@probe-1.body.id`) and fails closed when that
  reference is missing or malformed.
- **`runScenario`** — orchestrates one scenario: run probes, evaluate oracles, emit a Finding when oracles fail.
- **Capability preflight** — optionally reject unsupported probe kinds before
  executing steps or cleanup, preserving an explicit execution gap instead of
  partial side effects or a false finding.
- **Controlled shell driver** — `makeShellProbeRunner()` supports explicit,
  allowlisted argv checks with `shell:false`, bounded output, timeout cleanup,
  minimal environment and output redaction. It is not a sandbox and must be
  hosted inside the configured execution boundary.
- **Read-only SQL driver** — `makeSqlProbeRunner()` uses an injected DB
  adapter, separate parameters, `SELECT`/`WITH`/`EXPLAIN`-only policy, row
  limits and evidence redaction. It complements, but never replaces, a
  database read-only role and statement timeout.
- **Canonical outcomes** — scenario results distinguish `pass`, `fail`,
  `error`, `blocked` and reserved `not_run`; missing capabilities never look
  like a passing assertion.
- **Controlled Playwright driver** — `makePlaywrightProbeRunner()` provides a
  persistent browser context with origin allowlisting, structured actions,
  bounded/redacted text evidence and explicit `close()`. It does not permit
  arbitrary JavaScript or unrestricted navigation.
- **Postgres adapter** — `makePostgresSqlProbeRunner()` executes the generic
  read-only SQL contract in a `READ ONLY` transaction with statement timeout,
  bounded rows and explicit shutdown. Use a least-privilege role and secret
  manager in production; the DSN never belongs in a pack.
- **HTTP driver secret boundary** — an HTTP probe may declare
  `auth: "${SECRET_NAME}"`, but the host must inject the value through
  `HttpProbeRunnerOptions.secrets`. Missing or malformed references fail
  closed and secret values never become pack data or diagnostic output.
- **Agent tool guard** — `AgentToolGuard` applies explicit tool allowlists,
  call/output budgets and cooperative cancellation; `tool_call` events persist
  only hashes and bounded metadata, never raw agent tool payloads.
- **Agent trajectory recorder** — `AgentTrajectoryRecorder` pins model identity,
  enforces step/token budgets and records ordered `llm_call`/`tool_call` digests
  without persisting prompts, completions or tool results.
- **Trajectory verifier** — `verifyAgentTrajectory()` fails closed on altered
  order, identity, digests, totals or missing/mismatched hash-chain events.

The probe runner is injected as a function so the runner has no ambient network
surface; production hosts choose and configure the HTTP/shell/Playwright/SQL
drivers explicitly. Tests can therefore exercise the full loop with a
deterministic in-memory stub.

```ts
import { runScenario, EventChainWriter, FindingsWriter } from '@aqa/runner';

const events = new EventChainWriter('.aqa/runs/<id>/events.jsonl');
const findings = new FindingsWriter('.aqa/runs/<id>/findings.jsonl');
const result = await runScenario({
  scenario,
  run_id: 'run-…',
  probeRunner: async (p) => myHttpClient(p),
  events,
  findings,
});
```

Set `execution_mode: 'agent'` when a host-owned agent driver is injected.
Probe/oracle events and emitted findings then retain agent identity; provider
selection, tool policy, trajectory storage, and model pinning remain outside
this provider-neutral runner boundary.
