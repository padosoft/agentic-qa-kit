# The agentic QA methodology

> Risk × Invariant × Probe × Oracle × Replay. Long form.

## Why not a test runner

The dominant paradigm — write unit tests, run them, count green — fails at
three things the kit cares about:

1. **Coverage is structural, not behavioural.** 90% line coverage tells you
   the code was executed, not that any specific business rule still holds.
2. **Tests degrade silently.** When a regression appears, the test that should
   have caught it is the one nobody wrote.
3. **Agents are bad at writing fresh test code.** They're good at *exercising*
   a system if you tell them what matters.

The kit moves the centre of gravity from "code that exercises code" to
"rules that exercise code", and lets agents do the exercising.

## The five primitives

### Risk

A risk is a one-liner that names something that could go wrong: *Token replay
after rotation. Pagination cursor leaking other tenants. Form data lost on
refresh.* The taxonomy is intentionally human — every Risk has a category
(`auth`, `data`, `integrity`, `availability`, `confidentiality`, …), a
severity, and a likelihood. Severity and likelihood drive triage; the human
text drives understanding.

Each Risk owns one or more **Invariants**.

### Invariant

An invariant is a falsifiable, implementation-independent statement: *Old
tokens become invalid within 60 seconds of rotation.* It does **not** say
how the system implements rotation — it says what an outside observer must
see. If you can't write the invariant in one sentence, the risk is too broad;
split it.

### Probe

A probe is a single deterministic action that exercises the SUT in a way
relevant to the invariant. Probes have kinds: `http`, `shell`, `sql`,
`playwright`, `llm_eval`, `fs`, `custom`. A scenario is a sequence of probes
plus the oracles that judge them.

### Oracle

An oracle answers "did the invariant hold under that probe sequence?" Built-in
kinds: `http_status`, `response_contains`, `response_not_contains`,
`json_schema`, `db_query`, `semantic_llm_judge`, `custom`. Each oracle returns
`{ passed, reason, agreement }`. The runner combines agreements into the
finding's confidence score.

### Replay

A replay is the deterministic evidence that the bug reproduces. The kit
distinguishes three levels:

| Level            | What's reproducible                        | Artifact                |
|------------------|--------------------------------------------|-------------------------|
| `bug_level`      | The bug itself in the SUT                  | `repro.sh`, `repro.curl`|
| `scenario_level` | The full scenario YAML + seed              | `scenario.yaml + seed`  |
| `agent_level`    | The discovery process (best-effort)        | `prompt + model_pinned` |

A `status: 'verified'` Finding **must** declare a deterministic floor at the
declared `verification_floor`. The Zod schema enforces this.

## How a scenario actually runs

1. The runner reads the Scenario YAML.
2. For each probe: invoke the injected probe runner, capture the result, append
   a `probe_executed` event.
3. For each oracle: evaluate against the probe results, append an
   `oracle_evaluated` event.
4. If any oracle failed: build a draft Finding, append a `finding_emitted`
   event, write the finding to `findings.jsonl` (deduped within the run).
5. If a `release-gate` profile is active and the Finding is critical, the
   runner can exit non-zero so CI fails the merge.

## Confidence components

`Finding.confidence` is a single number, but it's the weighted sum of
explainable components:

- `oracle_agreement` — fraction of oracles that passed/failed coherently.
- `agent_self_reported` — when an agent runs the scenario, what it self-reports.
- `judge_ensemble` — LLM-as-judge ensemble agreement.
- `replay_success_rate` — successes / attempts at the verification floor.
- `historical_fp_rate` — calibrated false-positive rate for this scenario.

A confidence number without these components is treated as untrusted in the
admin UI.

## What the methodology is **not**

- Not a replacement for unit/integration tests. Pair them — unit tests prove
  the function works, agentic QA proves the system behaves.
- Not a one-shot bug finder. The point is the loop: write the risk, write the
  invariant, run, observe, refine.
- Not a substitute for a threat model. `pack-security` ships seed risks for
  OWASP Top 10, but `docs/security/threat-model.md` is where you spell out
  *your* system's risks.

## Recommended workflow

1. Run `aqa init` once per project.
2. Replace the seed Risk in `risk-map.yaml` with one that matters to your team.
3. Write one Scenario in plain YAML for that Risk.
4. Run `aqa run --profile smoke` until the Scenario produces a deterministic
   finding (or you're sure no bug exists).
5. Iterate. Add a second Risk only after the first one passes the release gate.

Junior contributors should ship their first Risk + Scenario within 30 minutes
of reading this doc. If they can't, the doc is wrong; file an issue.
