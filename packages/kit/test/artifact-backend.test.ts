import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { FileArtifactStore, S3ArtifactStore } from '@aqa/artifacts';
import { createRunArtifactStore } from '../dist/artifacts.js';

const names = [
  'AQA_ARTIFACT_S3_BUCKET',
  'AQA_ARTIFACT_S3_PREFIX',
  'AQA_ARTIFACT_S3_RETAIN_UNTIL',
  'AQA_ARTIFACT_S3_RETENTION_MODE',
  'AQA_ARTIFACT_S3_ENDPOINT',
  'AQA_ARTIFACT_S3_FORCE_PATH_STYLE',
  'AQA_ARTIFACT_S3_REQUIRE_RETENTION',
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
});
