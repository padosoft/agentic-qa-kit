/**
 * Server API client. When `VITE_AQA_SERVER_URL` is set at build time the
 * admin talks to a real `@aqa/server` instance via the routing table from
 * `makeApi()`. When it isn't set (local dev, demo deploys) we fall back to
 * the in-bundle `MOCK_*` fixtures so the admin is always usable.
 *
 * In **live mode**, fetch failures throw — the calling `useQuery` surfaces
 * the error and the UI renders an error state. We deliberately do NOT fall
 * back to mock under live mode, otherwise operators could see demo data
 * presented as if it were real (P2 review feedback, PR #20).
 *
 * In **mock mode**, the helpers return the in-bundle fixtures directly.
 *
 * The server returns `Run.Run` (with `state`, `totals.findings`,
 * `totals.llm_cost_usd`) and `Finding.Finding` per `@aqa/schemas`; the
 * helpers below map those into the UI types in `mock.ts` so screens stay
 * source-agnostic.
 */
import {
  MOCK_AGENTS,
  MOCK_FINDINGS,
  MOCK_PACKS,
  MOCK_PROFILES,
  MOCK_RISKS,
  MOCK_RUNS,
  type MockFinding,
  type MockPack,
  type MockProfile,
  type MockRisk,
  type MockRun,
} from './mock.ts';

const SERVER_URL = (import.meta.env.VITE_AQA_SERVER_URL as string | undefined) ?? '';

export function isLive(): boolean {
  return SERVER_URL.length > 0;
}

async function liveFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${SERVER_URL}${path}`, { credentials: 'include' });
  if (!res.ok) {
    throw new Error(`GET ${path} → ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

interface ServerRun {
  id: string;
  state: 'pending' | 'running' | 'succeeded' | 'failed' | 'aborted' | 'budget_exceeded';
  started_at: string;
  finished_at?: string;
  profile: string;
  totals?: { findings?: number; llm_cost_usd?: number };
}

function mapRun(r: ServerRun): MockRun {
  const status: MockRun['status'] =
    r.state === 'running' || r.state === 'pending'
      ? 'running'
      : r.state === 'succeeded'
        ? 'completed'
        : 'failed';
  const startedMs = new Date(r.started_at).getTime();
  const finishedMs = r.finished_at ? new Date(r.finished_at).getTime() : startedMs;
  const duration_s = Math.max(0, Math.round((finishedMs - startedMs) / 1000));
  return {
    id: r.id,
    profile: r.profile,
    started_at: r.started_at,
    duration_s,
    status,
    findings: r.totals?.findings ?? 0,
    cost_usd: r.totals?.llm_cost_usd ?? 0,
  };
}

interface ServerFinding {
  id: string;
  run_id: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  status: 'open' | 'verified' | 'fixed' | 'wontfix' | string;
  scenario_id: string;
  risk_id: string;
  summary?: string;
  title?: string;
  verification_floor?: 'L1' | 'L2' | 'L3';
  created_at?: string;
}

function mapFinding(f: ServerFinding): MockFinding {
  const status: MockFinding['status'] =
    f.status === 'verified' || f.status === 'fixed' || f.status === 'wontfix' || f.status === 'open'
      ? f.status
      : 'open';
  return {
    id: f.id,
    run_id: f.run_id,
    severity: f.severity,
    status,
    scenario_id: f.scenario_id,
    risk_id: f.risk_id,
    summary: f.summary ?? f.title ?? '(no summary)',
    verification_floor: f.verification_floor ?? 'L1',
    created_at: f.created_at ?? new Date(0).toISOString(),
  };
}

export async function fetchRuns(): Promise<MockRun[]> {
  if (!isLive()) return MOCK_RUNS;
  const r = await liveFetch<{ runs: ServerRun[] }>('/api/runs');
  return r.runs.map(mapRun);
}

export async function fetchFindings(): Promise<MockFinding[]> {
  if (!isLive()) return MOCK_FINDINGS;
  const r = await liveFetch<{ findings: ServerFinding[] }>('/api/findings');
  return r.findings.map(mapFinding);
}

export async function fetchPacks(): Promise<MockPack[]> {
  if (!isLive()) return MOCK_PACKS;
  const r = await liveFetch<{ packs: MockPack[] }>('/api/packs');
  return r.packs;
}

export async function fetchProfiles(): Promise<MockProfile[]> {
  if (!isLive()) return MOCK_PROFILES;
  const r = await liveFetch<{ profiles: MockProfile[] }>('/api/profiles');
  return r.profiles;
}

export async function fetchRisks(): Promise<MockRisk[]> {
  if (!isLive()) return MOCK_RISKS;
  const r = await liveFetch<{ risks: MockRisk[] }>('/api/risks');
  return r.risks;
}

export async function fetchAgents() {
  if (!isLive()) return MOCK_AGENTS;
  const r = await liveFetch<{ agents: typeof MOCK_AGENTS }>('/api/agents');
  return r.agents;
}
