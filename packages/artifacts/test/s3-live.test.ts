import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { S3ArtifactStore } from '../dist/index.js';

const endpoint = process.env.AQA_TEST_S3_ENDPOINT?.trim();
const encryption = process.env.AQA_TEST_S3_SERVER_SIDE_ENCRYPTION?.trim() as
  | 'AES256'
  | 'aws:kms'
  | 'aws:kms:dsse'
  | undefined;
const kmsKeyId = process.env.AQA_TEST_S3_SSE_KMS_KEY_ID?.trim() || undefined;
const retentionMode = (process.env.AQA_TEST_S3_RETENTION_MODE?.trim() || 'COMPLIANCE') as
  | 'GOVERNANCE'
  | 'COMPLIANCE';
const retentionHours = Number(process.env.AQA_TEST_S3_RETENTION_HOURS ?? '24');

test(
  'real S3-compatible artifact journey proves retention and read-back',
  { skip: endpoint ? false : 'AQA_TEST_S3_ENDPOINT is not configured' },
  async () => {
    if (!endpoint) return;

    const bucket = `aqa-ci-${Date.now()}-${randomUUID().slice(0, 8)}`;
    if (encryption && !['AES256', 'aws:kms', 'aws:kms:dsse'].includes(encryption))
      throw new Error('AQA_TEST_S3_SERVER_SIDE_ENCRYPTION is invalid');
    if (!['GOVERNANCE', 'COMPLIANCE'].includes(retentionMode))
      throw new Error('AQA_TEST_S3_RETENTION_MODE is invalid');
    if (!Number.isFinite(retentionHours) || retentionHours <= 0)
      throw new Error('AQA_TEST_S3_RETENTION_HOURS must be positive');
    if (kmsKeyId && encryption !== 'aws:kms' && encryption !== 'aws:kms:dsse')
      throw new Error('AQA_TEST_S3_SSE_KMS_KEY_ID requires KMS encryption');
    const clientConfig = {
      endpoint,
      region: process.env.AWS_REGION ?? 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'aqa-ci-access',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'aqa-ci-secret',
      },
    };
    const client = new S3Client(clientConfig);

    // The lock flag is part of bucket creation; object-level retention cannot
    // be trusted unless the provider accepts this capability at the bucket API.
    await client.send(
      new CreateBucketCommand({
        Bucket: bucket,
        ObjectLockEnabledForBucket: true,
      }),
    );

    const retainUntil = new Date(Date.now() + retentionHours * 60 * 60 * 1000);
    const store = new S3ArtifactStore({
      bucket,
      prefix: 'tenant/acme/runs/live-s3',
      retainUntil,
      retentionMode,
      verifyRetention: true,
      ...(encryption ? { serverSideEncryption: encryption, verifyEncryption: true } : {}),
      ...(kmsKeyId ? { sseKmsKeyId: kmsKeyId } : {}),
      client,
    });

    const ref = await store.putText(
      'events.jsonl',
      'Authorization: Bearer live-ci-secret\nemail=qa@example.test\n',
    );
    assert.equal(ref.key, 'events.jsonl');
    assert.equal(ref.redacted, true);
    assert.equal(ref.bytes > 0, true);

    const downloaded = Buffer.from(await store.get(ref), 'utf8').toString();
    assert.match(downloaded, /Bearer \[REDACTED\]/);
    assert.doesNotMatch(downloaded, /live-ci-secret|qa@example\.test/);

    const metadata = await store.head(ref);
    assert.deepEqual(metadata, ref);
  },
);
