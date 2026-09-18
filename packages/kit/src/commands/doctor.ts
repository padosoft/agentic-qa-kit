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
  /** Check production configuration prerequisites without contacting providers. */
  production?: boolean;
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

  if (opts.production) addProductionChecks(checks);

  return { profile, checks, worst: worstOf(checks) };
}

function addProductionChecks(checks: DoctorCheck[]): void {
  const hasStore = Boolean(process.env.AQA_STORE_DSN?.trim());
  const hasQueue = Boolean(process.env.AQA_QUEUE_DSN?.trim());
  const artifactBucket = Boolean(process.env.AQA_ARTIFACT_S3_BUCKET?.trim());
  const retention = process.env.AQA_ARTIFACT_S3_REQUIRE_RETENTION === 'true';
  const retentionConfigured = Boolean(
    process.env.AQA_ARTIFACT_S3_RETAIN_UNTIL?.trim() &&
      process.env.AQA_ARTIFACT_S3_RETENTION_MODE?.trim(),
  );
  const runnerJwt = Boolean(
    process.env.AQA_RUNNER_JWT_PUBLIC_KEY?.trim() &&
      process.env.AQA_RUNNER_JWT_ISSUER?.trim() &&
      process.env.AQA_RUNNER_JWT_AUDIENCE?.trim(),
  );
  const runnerToken = Boolean(process.env.AQA_RUNNER_TOKEN?.trim());
  const checkpoint = Boolean(
    process.env.AQA_AUDIT_CHECKPOINT_KEY_ID?.trim() &&
      process.env.AQA_AUDIT_CHECKPOINT_PRIVATE_KEY_PEM?.trim(),
  );
  const otlp = Boolean(process.env.AQA_OTLP_ENDPOINT?.trim());
  const sandboxImage = process.env.AQA_CONTAINER_IMAGE?.trim() ?? '';
  const sandboxImagePinned = /^.+@sha256:[0-9a-f]{64}$/u.test(sandboxImage);

  checks.push({
    id: 'production-store',
    title: 'Durable control-plane store configured',
    status: hasStore ? 'pass' : 'fail',
    detail: hasStore ? 'PostgreSQL DSN present (value hidden)' : 'AQA_STORE_DSN is missing',
    suggestion: hasStore
      ? undefined
      : 'Configure AQA_STORE_DSN for PostgreSQL; MemoryStore is development-only.',
  });
  checks.push({
    id: 'production-queue',
    title: 'Durable runner queue configured',
    status: hasQueue ? 'pass' : 'fail',
    detail: hasQueue ? 'PostgreSQL queue DSN present (value hidden)' : 'AQA_QUEUE_DSN is missing',
    suggestion: hasQueue ? undefined : 'Configure AQA_QUEUE_DSN for a multi-worker deployment.',
  });
  checks.push({
    id: 'production-artifacts',
    title: 'Durable artifact retention configured',
    status: artifactBucket && retention && retentionConfigured ? 'pass' : 'fail',
    detail: artifactBucket
      ? retention && retentionConfigured
        ? 'S3-compatible bucket + retention policy configured (values hidden)'
        : 'S3 bucket present but Object Lock retention is incomplete'
      : 'AQA_ARTIFACT_S3_BUCKET is missing',
    suggestion:
      artifactBucket && retention && retentionConfigured
        ? undefined
        : 'Configure S3 bucket, AQA_ARTIFACT_S3_REQUIRE_RETENTION=true, retain-until and GOVERNANCE/COMPLIANCE mode.',
  });
  checks.push({
    id: 'production-runner-auth',
    title: 'Runner authentication configured',
    status: hasQueue && (runnerJwt || runnerToken) ? 'pass' : 'fail',
    detail: runnerJwt
      ? 'scoped JWT verifier configured'
      : runnerToken
        ? 'bootstrap bearer token configured'
        : 'runner credential is missing or incomplete',
    suggestion:
      hasQueue && (runnerJwt || runnerToken)
        ? undefined
        : 'Configure the complete AQA_RUNNER_JWT_* set (preferred) or an explicit AQA_RUNNER_TOKEN.',
  });
  checks.push({
    id: 'production-audit-checkpoint',
    title: 'Audit completeness checkpoint configured',
    status: checkpoint && artifactBucket ? 'pass' : 'warn',
    detail:
      checkpoint && artifactBucket
        ? 'signer and durable artifact target configured (values hidden)'
        : 'checkpoint signer or durable target is not configured',
    suggestion:
      checkpoint && artifactBucket
        ? undefined
        : 'Configure AQA_AUDIT_CHECKPOINT_KEY_ID/private key and a durable artifact backend.',
  });
  checks.push({
    id: 'production-observability',
    title: 'OTLP observability endpoint configured',
    status: otlp ? 'pass' : 'warn',
    detail: otlp ? 'OTLP endpoint present (value hidden)' : 'AQA_OTLP_ENDPOINT is not configured',
    suggestion: otlp ? undefined : 'Configure OTLP export before claiming production SLO evidence.',
  });
  checks.push({
    id: 'production-sandbox-image',
    title: 'Hardened sandbox image is immutable',
    status: sandboxImagePinned ? 'pass' : 'fail',
    detail: sandboxImagePinned
      ? 'AQA_CONTAINER_IMAGE digest configured (value hidden)'
      : 'AQA_CONTAINER_IMAGE is missing or is not a full sha256 digest',
    suggestion: sandboxImagePinned
      ? undefined
      : 'Configure AQA_CONTAINER_IMAGE as registry/image@sha256:<64 lowercase hex> for security/release-gate runs.',
  });
}

function agentFilesPresent(root: string): boolean {
  return (
    existsSync(join(root, 'AGENTS.md')) ||
    existsSync(join(root, 'CLAUDE.md')) ||
    existsSync(join(root, 'GEMINI.md')) ||
    existsSync(join(root, '.github', 'copilot-instructions.md'))
  );
}
