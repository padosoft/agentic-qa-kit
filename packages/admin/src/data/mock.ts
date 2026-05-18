export interface MockRun {
  id: string;
  profile: string;
  started_at: string;
  duration_s: number;
  status: 'completed' | 'failed' | 'running';
  findings: number;
  cost_usd: number;
}

/**
 * UI-facing finding shape. Mirrors `@aqa/schemas` `Finding.Finding`:
 *   - `status`: schema enum `draft`/`verified`/`rejected`/`duplicate`/`fixed`
 *   - `verification_floor`: schema enum `bug_level`/`scenario_level`/`agent_level`
 *   - `created_at` is the UI alias for the schema field `discovered_at`
 *     (the mapper in `data/api.ts` translates).
 */
export type UiFindingStatus = 'draft' | 'verified' | 'rejected' | 'duplicate' | 'fixed';
export type UiVerificationFloor = 'bug_level' | 'scenario_level' | 'agent_level';

export interface MockFinding {
  id: string;
  run_id: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  status: UiFindingStatus;
  scenario_id: string;
  risk_id: string;
  summary: string;
  verification_floor: UiVerificationFloor;
  created_at: string;
}

export interface MockPack {
  slug: string;
  version: string;
  signed: boolean;
  scenarios: number;
  risks: number;
}

export interface MockProfile {
  name: string;
  packs: string[];
  execution_mode: 'sandbox' | 'host';
  budget_usd: number;
}

export interface MockRisk {
  id: string;
  category: string;
  severity: string;
  title: string;
  tags: string[];
}

export const MOCK_RUNS: MockRun[] = [
  {
    id: 'run-2026-05-17-a',
    profile: 'release-gate',
    started_at: '2026-05-17T08:12:00Z',
    duration_s: 184,
    status: 'completed',
    findings: 7,
    cost_usd: 1.42,
  },
  {
    id: 'run-2026-05-17-b',
    profile: 'security',
    started_at: '2026-05-17T10:05:00Z',
    duration_s: 312,
    status: 'completed',
    findings: 12,
    cost_usd: 2.18,
  },
  {
    id: 'run-2026-05-18-a',
    profile: 'smoke',
    started_at: '2026-05-18T07:30:00Z',
    duration_s: 48,
    status: 'completed',
    findings: 1,
    cost_usd: 0.21,
  },
  {
    id: 'run-2026-05-18-b',
    profile: 'exploratory',
    started_at: '2026-05-18T09:14:00Z',
    duration_s: 0,
    status: 'running',
    findings: 0,
    cost_usd: 0.0,
  },
  {
    id: 'run-2026-05-18-c',
    profile: 'release-gate',
    started_at: '2026-05-18T09:55:00Z',
    duration_s: 22,
    status: 'failed',
    findings: 0,
    cost_usd: 0.05,
  },
];

export const MOCK_FINDINGS: MockFinding[] = [
  {
    id: 'f-001',
    run_id: 'run-2026-05-17-b',
    severity: 'critical',
    status: 'verified',
    scenario_id: 'sc-auth-bypass',
    risk_id: 'r-auth-001',
    summary: 'JWT signature not validated on /api/admin',
    verification_floor: 'bug_level',
    created_at: '2026-05-17T10:08:00Z',
  },
  {
    id: 'f-002',
    run_id: 'run-2026-05-17-b',
    severity: 'critical',
    status: 'verified',
    scenario_id: 'sc-auth-bypass',
    risk_id: 'r-auth-001',
    summary: 'JWT signature not validated on /api/admin',
    verification_floor: 'bug_level',
    created_at: '2026-05-17T10:12:00Z',
  },
  {
    id: 'f-003',
    run_id: 'run-2026-05-17-a',
    severity: 'high',
    status: 'draft',
    scenario_id: 'sc-idor-tenant',
    risk_id: 'r-data-014',
    summary: 'Tenant ID accepted from header overrides session tenant',
    verification_floor: 'scenario_level',
    created_at: '2026-05-17T08:14:00Z',
  },
  {
    id: 'f-004',
    run_id: 'run-2026-05-17-b',
    severity: 'high',
    status: 'draft',
    scenario_id: 'sc-cookie-flags',
    risk_id: 'r-auth-007',
    summary: 'Session cookie missing Secure flag in dev profile',
    verification_floor: 'scenario_level',
    created_at: '2026-05-17T10:21:00Z',
  },
  {
    id: 'f-005',
    run_id: 'run-2026-05-17-a',
    severity: 'medium',
    status: 'fixed',
    scenario_id: 'sc-csrf-form',
    risk_id: 'r-auth-009',
    summary: 'POST /api/settings accepts cross-origin form',
    verification_floor: 'agent_level',
    created_at: '2026-05-17T08:17:00Z',
  },
  {
    id: 'f-006',
    run_id: 'run-2026-05-18-a',
    severity: 'low',
    status: 'draft',
    scenario_id: 'sc-cache-control',
    risk_id: 'r-data-022',
    summary: '/api/me missing Cache-Control: no-store',
    verification_floor: 'agent_level',
    created_at: '2026-05-18T07:30:00Z',
  },
];

export const MOCK_PACKS: MockPack[] = [
  { slug: '@aqa/pack-core', version: '1.0.0', signed: true, scenarios: 12, risks: 8 },
  { slug: '@aqa/pack-api-core', version: '1.0.0', signed: true, scenarios: 28, risks: 19 },
  { slug: '@aqa/pack-web-ui', version: '1.0.0', signed: true, scenarios: 22, risks: 14 },
  { slug: '@aqa/pack-llm-agent', version: '1.0.0', signed: true, scenarios: 16, risks: 11 },
  { slug: '@aqa/pack-security', version: '1.0.0', signed: true, scenarios: 41, risks: 27 },
];

export const MOCK_PROFILES: MockProfile[] = [
  {
    name: 'smoke',
    packs: ['@aqa/pack-core', '@aqa/pack-api-core'],
    execution_mode: 'sandbox',
    budget_usd: 1,
  },
  {
    name: 'exploratory',
    packs: ['@aqa/pack-core', '@aqa/pack-api-core', '@aqa/pack-web-ui'],
    execution_mode: 'sandbox',
    budget_usd: 5,
  },
  {
    name: 'security',
    packs: ['@aqa/pack-core', '@aqa/pack-security'],
    execution_mode: 'sandbox',
    budget_usd: 10,
  },
  {
    name: 'release-gate',
    packs: ['@aqa/pack-core', '@aqa/pack-api-core', '@aqa/pack-web-ui', '@aqa/pack-security'],
    execution_mode: 'sandbox',
    budget_usd: 15,
  },
];

export const MOCK_RISKS: MockRisk[] = [
  {
    id: 'r-auth-001',
    category: 'auth',
    severity: 'critical',
    title: 'JWT signature validation',
    tags: ['owasp:a02', 'owasp:a07'],
  },
  {
    id: 'r-auth-007',
    category: 'auth',
    severity: 'high',
    title: 'Session cookie flags',
    tags: ['owasp:a07'],
  },
  {
    id: 'r-auth-009',
    category: 'auth',
    severity: 'medium',
    title: 'CSRF on state-changing endpoints',
    tags: ['owasp:a01'],
  },
  {
    id: 'r-data-014',
    category: 'data',
    severity: 'high',
    title: 'Tenant isolation',
    tags: ['owasp:a01', 'owasp:a04'],
  },
  {
    id: 'r-data-022',
    category: 'data',
    severity: 'low',
    title: 'Caching of sensitive responses',
    tags: ['owasp:a05'],
  },
  {
    id: 'r-agentic-002',
    category: 'agentic',
    severity: 'high',
    title: 'Tool-call confirmation',
    tags: ['owasp-agentic:a02'],
  },
];

export const MOCK_AGENTS = [
  { name: 'Claude Code', files: ['CLAUDE.md', '.claude/skills/aqa-*'], installed: true },
  { name: 'Codex CLI', files: ['AGENTS.md'], installed: true },
  { name: 'Gemini CLI', files: ['GEMINI.md'], installed: true },
  { name: 'GitHub Copilot CLI', files: ['.github/copilot-instructions.md'], installed: true },
];
