# @aqa/runner

Orchestrator runner for `agentic-qa-kit`. Ships:

- **`RunLifecycle`** — state machine (pending → running → {succeeded, failed, aborted, budget_exceeded}).
- **`EventChainWriter`** — append-only `events.jsonl` writer. Each event computes
  `hash = sha256(prev_hash || canonical(event))`, giving the audit log SOC2-style tamper evidence.
- **`FindingsWriter`** — append-only `findings.jsonl` with in-run dedup on `(run_id, scenario_id, risk_id, severity)`.
- **`evaluateOracle`** + built-in `http_status` / `response_contains` / `response_not_contains` oracles.
- **`runScenario`** — orchestrates one scenario: run probes, evaluate oracles, emit a Finding when oracles fail.

The probe runner is injected as a function so the runner has no built-in network surface; HTTP /
shell / Playwright / SQL drivers ship in subsequent passes. Tests can therefore exercise the full
loop with a deterministic in-memory stub.

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
