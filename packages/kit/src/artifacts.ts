import {
  type ArtifactStore,
  FileArtifactStore,
  S3ArtifactStore,
  type S3ArtifactStoreOptions,
} from '@aqa/artifacts';

const AUDIT_BUCKET = 'AQA_AUDIT_CHECKPOINT_S3_BUCKET';

/**
 * Select the separately administered checkpoint store for CLI runs.
 *
 * A configured audit bucket is deliberately stricter than the ordinary run
 * store: it must declare Object Lock retention and reads it back after every
 * write. Returning undefined is only allowed when no audit-bucket settings are
 * present at all.
 */
export function createAuditCheckpointStore(): ArtifactStore | undefined {
  const bucket = process.env[AUDIT_BUCKET]?.trim();
  const configNames = [
    AUDIT_BUCKET,
    'AQA_AUDIT_CHECKPOINT_S3_PREFIX',
    'AQA_AUDIT_CHECKPOINT_S3_ENDPOINT',
    'AQA_AUDIT_CHECKPOINT_S3_FORCE_PATH_STYLE',
    'AQA_AUDIT_CHECKPOINT_S3_RETAIN_UNTIL',
    'AQA_AUDIT_CHECKPOINT_S3_RETENTION_MODE',
  ];
  const anyConfigured = configNames.some((name) => Boolean(process.env[name]?.trim()));
  if (!bucket) {
    if (anyConfigured) throw new Error(`${AUDIT_BUCKET} is required for audit checkpoint storage`);
    return undefined;
  }
  const retainUntilRaw = process.env.AQA_AUDIT_CHECKPOINT_S3_RETAIN_UNTIL?.trim();
  const retentionMode = process.env.AQA_AUDIT_CHECKPOINT_S3_RETENTION_MODE?.trim() as
    | S3ArtifactStoreOptions['retentionMode']
    | undefined;
  const retainUntil = retainUntilRaw ? new Date(retainUntilRaw) : undefined;
  if (!retainUntil || Number.isNaN(retainUntil.getTime())) {
    throw new Error(
      'AQA_AUDIT_CHECKPOINT_S3_RETAIN_UNTIL must be a valid ISO timestamp when audit checkpoint storage is configured',
    );
  }
  if (retentionMode !== 'COMPLIANCE') {
    throw new Error(
      'AQA_AUDIT_CHECKPOINT_S3_RETENTION_MODE must be COMPLIANCE for audit checkpoint storage',
    );
  }
  return new S3ArtifactStore({
    bucket,
    ...(process.env.AQA_AUDIT_CHECKPOINT_S3_PREFIX?.trim()
      ? { prefix: process.env.AQA_AUDIT_CHECKPOINT_S3_PREFIX.trim() }
      : {}),
    retainUntil,
    retentionMode,
    verifyRetention: true,
    clientConfig: {
      region: process.env.AWS_REGION ?? 'us-east-1',
      ...(process.env.AQA_AUDIT_CHECKPOINT_S3_ENDPOINT
        ? { endpoint: process.env.AQA_AUDIT_CHECKPOINT_S3_ENDPOINT }
        : {}),
      forcePathStyle: process.env.AQA_AUDIT_CHECKPOINT_S3_FORCE_PATH_STYLE === 'true',
    },
  });
}

/** Select the local or S3-compatible run artifact backend from deployment env. */
export function createRunArtifactStore(root: string, runId: string): ArtifactStore {
  const bucket = process.env.AQA_ARTIFACT_S3_BUCKET;
  if (!bucket) return new FileArtifactStore(root);

  const basePrefix = process.env.AQA_ARTIFACT_S3_PREFIX?.trim() ?? '';
  const prefix = [basePrefix, runId].filter(Boolean).join('/');
  const retentionUntilRaw = process.env.AQA_ARTIFACT_S3_RETAIN_UNTIL?.trim();
  const requireRetention = process.env.AQA_ARTIFACT_S3_REQUIRE_RETENTION === 'true';
  const retentionMode = process.env.AQA_ARTIFACT_S3_RETENTION_MODE?.trim() as
    | S3ArtifactStoreOptions['retentionMode']
    | undefined;
  const retentionUntil = retentionUntilRaw ? new Date(retentionUntilRaw) : undefined;
  if (retentionUntilRaw && Number.isNaN(retentionUntil?.getTime())) {
    throw new Error('AQA_ARTIFACT_S3_RETAIN_UNTIL must be an ISO timestamp');
  }
  if (retentionMode && retentionMode !== 'GOVERNANCE' && retentionMode !== 'COMPLIANCE') {
    throw new Error('AQA_ARTIFACT_S3_RETENTION_MODE must be GOVERNANCE or COMPLIANCE');
  }
  if (requireRetention && (!retentionUntil || !retentionMode)) {
    throw new Error(
      'AQA_ARTIFACT_S3_REQUIRE_RETENTION=true requires AQA_ARTIFACT_S3_RETAIN_UNTIL and AQA_ARTIFACT_S3_RETENTION_MODE',
    );
  }
  const clientConfig = {
    region: process.env.AWS_REGION ?? 'us-east-1',
    ...(process.env.AQA_ARTIFACT_S3_ENDPOINT
      ? { endpoint: process.env.AQA_ARTIFACT_S3_ENDPOINT }
      : {}),
    forcePathStyle: process.env.AQA_ARTIFACT_S3_FORCE_PATH_STYLE === 'true',
  };
  return new S3ArtifactStore({
    bucket,
    prefix,
    ...(retentionUntil ? { retainUntil: retentionUntil } : {}),
    ...(retentionMode ? { retentionMode } : {}),
    ...(requireRetention ? { verifyRetention: true } : {}),
    clientConfig,
  });
}
