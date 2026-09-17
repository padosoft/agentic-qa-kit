import {
  type ArtifactStore,
  FileArtifactStore,
  S3ArtifactStore,
  type S3ArtifactStoreOptions,
} from '@aqa/artifacts';

/** Select the local or S3-compatible run artifact backend from deployment env. */
export function createRunArtifactStore(root: string, runId: string): ArtifactStore {
  const bucket = process.env.AQA_ARTIFACT_S3_BUCKET;
  if (!bucket) return new FileArtifactStore(root);

  const basePrefix = process.env.AQA_ARTIFACT_S3_PREFIX?.trim() ?? '';
  const prefix = [basePrefix, runId].filter(Boolean).join('/');
  const retentionUntilRaw = process.env.AQA_ARTIFACT_S3_RETAIN_UNTIL?.trim();
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
    clientConfig,
  });
}
