/**
 * Server API client. When `VITE_AQA_SERVER_URL` is set at build time the
 * admin talks to a real `@aqa/server` instance via the routing table from
 * `makeApi()`. When it isn't set (local dev, demo deploys) we fall back to
 * the in-bundle `MOCK_*` fixtures so the admin is always usable.
 *
 * The hooks below intentionally mirror the response shape of the server's
 * routes so the screens don't know which mode they're in.
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

async function tryFetch<T>(path: string, fallback: T): Promise<T> {
  if (!isLive()) return fallback;
  try {
    const res = await fetch(`${SERVER_URL}${path}`, { credentials: 'include' });
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

export async function fetchRuns(): Promise<MockRun[]> {
  const r = await tryFetch<{ runs?: MockRun[] }>('/api/runs', { runs: MOCK_RUNS });
  return r.runs ?? MOCK_RUNS;
}

export async function fetchFindings(): Promise<MockFinding[]> {
  const r = await tryFetch<{ findings?: MockFinding[] }>('/api/findings', {
    findings: MOCK_FINDINGS,
  });
  return r.findings ?? MOCK_FINDINGS;
}

export async function fetchPacks(): Promise<MockPack[]> {
  const r = await tryFetch<{ packs?: MockPack[] }>('/api/packs', { packs: MOCK_PACKS });
  return r.packs ?? MOCK_PACKS;
}

export async function fetchProfiles(): Promise<MockProfile[]> {
  const r = await tryFetch<{ profiles?: MockProfile[] }>('/api/profiles', {
    profiles: MOCK_PROFILES,
  });
  return r.profiles ?? MOCK_PROFILES;
}

export async function fetchRisks(): Promise<MockRisk[]> {
  const r = await tryFetch<{ risks?: MockRisk[] }>('/api/risks', { risks: MOCK_RISKS });
  return r.risks ?? MOCK_RISKS;
}

export async function fetchAgents() {
  const r = await tryFetch<{ agents?: typeof MOCK_AGENTS }>('/api/agents', { agents: MOCK_AGENTS });
  return r.agents ?? MOCK_AGENTS;
}
