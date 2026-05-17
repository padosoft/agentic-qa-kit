import { Finding, type Scenario } from '@aqa/schemas';
import type { EventChainWriter } from './events.js';
import type { FindingsWriter } from './findings.js';
import { RunLifecycle } from './lifecycle.js';
import { type OracleResult, type ProbeRunResult, evaluateOracle } from './oracles.js';

export interface ScenarioRunResult {
  scenario_id: string;
  probes: readonly ProbeRunResult[];
  oracles: readonly OracleResult[];
  finding: Finding.Finding | null;
}

export type ProbeRunner = (probe: Scenario.Probe) => Promise<ProbeRunResult>;

export interface RunScenarioOptions {
  scenario: Scenario.Scenario;
  run_id: string;
  /** Inject a probe runner — defaults to a "no-network" stub that records nothing. */
  probeRunner?: ProbeRunner;
  events?: EventChainWriter;
  findings?: FindingsWriter;
  /** Used to seed Finding.id when oracles fail. */
  findingIdSeed?: number;
}

const NO_NETWORK_PROBE: ProbeRunner = async (p) => ({
  probe_id: p.id,
  status: 200,
  body: null,
});

export async function runScenario(opts: RunScenarioOptions): Promise<ScenarioRunResult> {
  const runner = opts.probeRunner ?? NO_NETWORK_PROBE;
  const probeResults: ProbeRunResult[] = [];
  for (const probe of opts.scenario.steps) {
    const r = await runner(probe);
    probeResults.push(r);
    opts.events?.append({
      ts: new Date().toISOString(),
      run_id: opts.run_id,
      kind: 'probe_executed',
      actor: { type: 'orchestrator', id: 'runner' },
      scenario_id: opts.scenario.id,
      payload: { probe_id: probe.id, status: r.status, error: r.error },
    });
  }
  const oracleResults: OracleResult[] = [];
  for (const oracle of opts.scenario.oracles) {
    const r = evaluateOracle(oracle, { probes: probeResults });
    oracleResults.push(r);
    opts.events?.append({
      ts: new Date().toISOString(),
      run_id: opts.run_id,
      kind: 'oracle_evaluated',
      actor: { type: 'orchestrator', id: 'runner' },
      scenario_id: opts.scenario.id,
      payload: { oracle_id: oracle.id, passed: r.passed, reason: r.reason },
    });
  }
  const failed = oracleResults.filter((o) => !o.passed);
  let finding: Finding.Finding | null = null;
  if (failed.length > 0) {
    const year = new Date().getUTCFullYear();
    const seed = String(opts.findingIdSeed ?? Math.floor(Math.random() * 9000) + 1000).padStart(
      4,
      '0',
    );
    const agreement = oracleResults.length
      ? oracleResults.reduce((s, o) => s + o.agreement, 0) / oracleResults.length
      : 0;
    finding = Finding.Finding.parse({
      schema_version: '1',
      id: `AQA-${year}-${seed}`,
      run_id: opts.run_id,
      scenario_id: opts.scenario.id,
      risk_id: opts.scenario.risk_refs[0],
      title: `${opts.scenario.title} — oracle(s) failed`,
      summary: failed.map((f) => `[${f.oracle_id}] ${f.reason}`).join('; '),
      severity: 'high',
      status: 'draft',
      execution_mode: 'orchestrator',
      discovered_at: new Date().toISOString(),
      confidence: agreement,
      confidence_components: { oracle_agreement: agreement },
      reproducibility: {},
      verification_floor: 'scenario_level',
      evidence: [],
    });
    opts.findings?.append(finding);
    opts.events?.append({
      ts: new Date().toISOString(),
      run_id: opts.run_id,
      kind: 'finding_emitted',
      actor: { type: 'orchestrator', id: 'runner' },
      scenario_id: opts.scenario.id,
      finding_id: finding.id,
      payload: { severity: finding.severity },
    });
  }
  return { scenario_id: opts.scenario.id, probes: probeResults, oracles: oracleResults, finding };
}

export { RunLifecycle };
