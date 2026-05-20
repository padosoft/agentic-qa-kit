import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { type ProjectProfile, profileRepo } from '../profiler.js';
import { runValidate } from './validate.js';

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface DoctorCheck {
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
  suggestion?: string | undefined;
}

export interface DoctorResult {
  profile: ProjectProfile;
  checks: DoctorCheck[];
  worst: CheckStatus;
}

export interface DoctorOptions {
  root: string;
}

const STATUS_RANK: Record<CheckStatus, number> = { pass: 0, warn: 1, fail: 2 };

function worstOf(checks: DoctorCheck[]): CheckStatus {
  let max: CheckStatus = 'pass';
  for (const c of checks) {
    if (STATUS_RANK[c.status] > STATUS_RANK[max]) max = c.status;
  }
  return max;
}

export function runDoctor(opts: DoctorOptions): DoctorResult {
  const profile = profileRepo(opts.root);
  const checks: DoctorCheck[] = [];

  checks.push({
    id: 'runtime',
    title: 'Runtime detected',
    status: profile.runtime === 'unknown' ? 'fail' : 'pass',
    detail: profile.runtime,
    suggestion:
      profile.runtime === 'unknown'
        ? 'Add a package.json or bunfig.toml so the kit can identify the runtime.'
        : undefined,
  });

  checks.push({
    id: 'aqa-dir',
    title: '.aqa directory present',
    status: profile.has_aqa ? 'pass' : 'warn',
    detail: profile.has_aqa ? 'found' : 'missing',
    suggestion: profile.has_aqa ? undefined : 'Run `aqa init` to bootstrap `.aqa/`.',
  });

  checks.push({
    id: 'test-runner',
    title: 'Test runner detected',
    status: profile.test_runner ? 'pass' : 'warn',
    detail: profile.test_runner ?? 'none',
    suggestion: profile.test_runner
      ? undefined
      : 'No test runner detected. AQA scenarios are not unit tests, but a runner is recommended for fast pre-checks.',
  });

  if (profile.has_aqa) {
    const validation = runValidate({ root: opts.root });
    if (validation.ok) {
      checks.push({
        id: 'aqa-validate',
        title: '.aqa/* schemas valid',
        status: 'pass',
        detail: `${validation.checked.length} files validated`,
      });
    } else {
      checks.push({
        id: 'aqa-validate',
        title: '.aqa/* schemas valid',
        status: 'fail',
        detail: `${validation.issues.length} issue(s)`,
        suggestion: 'Run `aqa validate` for full error paths.',
      });
    }
  }

  const docsPresent = agentFilesPresent(opts.root);
  checks.push({
    id: 'docs',
    title: 'AGENTS.md / CLAUDE.md / GEMINI.md / copilot-instructions present',
    status: docsPresent ? 'pass' : 'warn',
    detail: docsPresent
      ? 'at least one agent instruction file found'
      : 'no agent instruction files',
    suggestion: docsPresent
      ? undefined
      : 'Run `aqa install-agent-files --targets claude,codex,gemini,copilot` to scaffold agent-specific instructions.',
  });

  return { profile, checks, worst: worstOf(checks) };
}

function agentFilesPresent(root: string): boolean {
  return (
    existsSync(join(root, 'AGENTS.md')) ||
    existsSync(join(root, 'CLAUDE.md')) ||
    existsSync(join(root, 'GEMINI.md')) ||
    existsSync(join(root, '.github', 'copilot-instructions.md'))
  );
}
