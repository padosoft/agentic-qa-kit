import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { FileArtifactStore, S3ArtifactStore } from '@aqa/artifacts';
import { createAuditCheckpointStore, createRunArtifactStore } from '../dist/artifacts.js';

const names = [
  'AQA_ARTIFACT_S3_BUCKET',
  'AQA_ARTIFACT_S3_PREFIX',
  'AQA_ARTIFACT_S3_RETAIN_UNTIL',
  'AQA_ARTIFACT_S3_RETENTION_MODE',
  'AQA_ARTIFACT_S3_ENDPOINT',
  'AQA_ARTIFACT_S3_FORCE_PATH_STYLE',
  'AQA_ARTIFACT_S3_REQUIRE_RETENTION',
  'AQA_AUDIT_CHECKPOINT_S3_BUCKET',
  'AQA_AUDIT_CHECKPOINT_S3_PREFIX',
  'AQA_AUDIT_CHECKPOINT_S3_ENDPOINT',
  'AQA_AUDIT_CHECKPOINT_S3_FORCE_PATH_STYLE',
  'AQA_AUDIT_CHECKPOINT_S3_RETAIN_UNTIL',
  'AQA_AUDIT_CHECKPOINT_S3_RETENTION_MODE',
] as const;
const saved = new Map<string, string | undefined>();

afterEach(() => {
  for (const name of names) {
    const previous = saved.get(name);
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
  saved.clear();
});

function setEnv(name: (typeof names)[number], value: string) {
  if (!saved.has(name)) saved.set(name, process.env[name]);
  process.env[name] = value;
}

describe('run artifact backend', () => {
  it('defaults to the local store', () => {
    setEnv('AQA_ARTIFACT_S3_BUCKET', '');
    assert.equal(createRunArtifactStore('/tmp/run', 'run-1') instanceof FileArtifactStore, true);
  });

  it('selects S3 and validates retention configuration', () => {
    setEnv('AQA_ARTIFACT_S3_BUCKET', 'aqa-artifacts');
    setEnv('AQA_ARTIFACT_S3_PREFIX', 'tenant/acme');
    assert.equal(createRunArtifactStore('/tmp/run', 'run-1') instanceof S3ArtifactStore, true);
    setEnv('AQA_ARTIFACT_S3_RETAIN_UNTIL', 'not-a-date');
    assert.throws(() => createRunArtifactStore('/tmp/run', 'run-1'), /ISO timestamp/);
  });

  it('fails closed when production retention is required but not configured', () => {
    setEnv('AQA_ARTIFACT_S3_BUCKET', 'aqa-artifacts');
    setEnv('AQA_ARTIFACT_S3_REQUIRE_RETENTION', 'true');
    assert.throws(() => createRunArtifactStore('/tmp/run', 'run-1'), /requires/);
  });

  it('requires a dedicated compliance-retained bucket for CLI checkpoint publication', () => {
    assert.equal(createAuditCheckpointStore(), undefined);
    setEnv('AQA_AUDIT_CHECKPOINT_S3_BUCKET', 'aqa-audit');
    assert.throws(() => createAuditCheckpointStore(), /RETAIN_UNTIL/);
    setEnv('AQA_AUDIT_CHECKPOINT_S3_RETAIN_UNTIL', '2030-01-01T00:00:00Z');
    assert.throws(() => createAuditCheckpointStore(), /RETENTION_MODE/);
    setEnv('AQA_AUDIT_CHECKPOINT_S3_RETENTION_MODE', 'COMPLIANCE');
    assert.equal(createAuditCheckpointStore() instanceof S3ArtifactStore, true);
  });
});
