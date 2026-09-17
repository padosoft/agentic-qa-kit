import { createHash } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import type { ArtifactRef, ArtifactStore } from './index.js';
import { redactJson, redactText } from './index.js';

export interface S3ArtifactStoreOptions {
  bucket: string;
  prefix?: string;
  /** Optional Object Lock retention applied to newly written objects. */
  retainUntil?: Date;
  retentionMode?: 'GOVERNANCE' | 'COMPLIANCE';
  /** Read back Object Lock state after each write and fail closed on mismatch. */
  verifyRetention?: boolean;
}

export type S3ArtifactClient = Pick<S3Client, 'send'>;

/** S3-compatible store for AWS S3, MinIO and compatible private-cloud APIs. */
export class S3ArtifactStore implements ArtifactStore {
  private readonly client: S3ArtifactClient;
  private readonly bucket: string;
  private readonly prefix: string;
  private readonly retainUntil: Date | undefined;
  private readonly retentionMode: 'GOVERNANCE' | 'COMPLIANCE' | undefined;
  private readonly verifyRetention: boolean;

  constructor(options: S3ArtifactStoreOptions & { client: S3ArtifactClient });
  constructor(options: S3ArtifactStoreOptions & { clientConfig?: S3ClientConfig });
  constructor(
    options: S3ArtifactStoreOptions & {
      client?: S3ArtifactClient;
      clientConfig?: S3ClientConfig;
    },
  ) {
    this.client = options.client ?? new S3Client(options.clientConfig ?? {});
    this.bucket = options.bucket;
    this.prefix = normalizePrefix(options.prefix);
    this.retainUntil = options.retainUntil;
    this.retentionMode = options.retentionMode;
    this.verifyRetention = options.verifyRetention ?? false;
    if (this.retainUntil && !this.retentionMode) {
      throw new Error('retentionMode is required when retainUntil is configured');
    }
    if (this.retentionMode && !this.retainUntil) {
      throw new Error('retainUntil is required when retentionMode is configured');
    }
  }

  async putText(key: string, value: string, contentType = 'text/plain; charset=utf-8') {
    return this.put(key, Buffer.from(redactText(value), 'utf8'), contentType, true);
  }

  async putJson(key: string, value: unknown) {
    return this.put(
      key,
      Buffer.from(`${JSON.stringify(redactJson(value))}\n`, 'utf8'),
      'application/json',
      true,
    );
  }

  async putBytes(key: string, value: Uint8Array, contentType = 'application/octet-stream') {
    return this.put(key, Buffer.from(value), contentType, false);
  }

  async get(ref: ArtifactRef): Promise<Uint8Array> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(ref.key) }),
    );
    if (!result.Body) throw new Error(`artifact object is empty: ${ref.key}`);
    const body = result.Body as { transformToByteArray?: () => Promise<Uint8Array> };
    if (!body.transformToByteArray) throw new Error('S3 response body cannot be read');
    const bytes = await body.transformToByteArray();
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== ref.sha256) throw new Error(`artifact digest mismatch: ${ref.key}`);
    return bytes;
  }

  async delete(ref: ArtifactRef): Promise<void> {
    await Promise.all([
      this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: this.objectKey(ref.key) }),
      ),
      this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: this.metadataKey(ref.key) }),
      ),
    ]);
  }

  async head(ref: ArtifactRef): Promise<ArtifactRef> {
    const result = await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: this.metadataKey(ref.key) }),
    );
    const metadata = result.Metadata?.artifact;
    if (!metadata) throw new Error(`artifact metadata is missing: ${ref.key}`);
    return JSON.parse(Buffer.from(metadata, 'base64').toString('utf8')) as ArtifactRef;
  }

  private async put(
    key: string,
    bytes: Buffer,
    contentType: string,
    redacted: boolean,
  ): Promise<ArtifactRef> {
    const clean = safeKey(key);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const ref: ArtifactRef = {
      id: `sha256:${sha256}`,
      key: clean,
      sha256,
      bytes: bytes.byteLength,
      content_type: contentType,
      redacted,
      created_at: new Date().toISOString(),
    };
    const retention = {
      ObjectLockMode: this.retentionMode,
      ObjectLockRetainUntilDate: this.retainUntil,
    };
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(clean),
        Body: bytes,
        ContentType: contentType,
        Metadata: { sha256, artifact_id: ref.id },
        ...retention,
      }),
    );
    if (this.verifyRetention) await this.assertRetention(clean);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.metadataKey(clean),
        Body: `${JSON.stringify(ref)}\n`,
        ContentType: 'application/json',
        Metadata: { artifact: Buffer.from(JSON.stringify(ref), 'utf8').toString('base64') },
        ...retention,
      }),
    );
    if (this.verifyRetention) await this.assertRetention(this.metadataKey(clean));
    return ref;
  }

  private async assertRetention(key: string): Promise<void> {
    const result = await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }),
    );
    const actualMode = result.ObjectLockMode;
    const actualUntil = result.ObjectLockRetainUntilDate;
    if (actualMode !== this.retentionMode) {
      throw new Error(
        `S3 Object Lock mode mismatch for ${key}: expected ${this.retentionMode}, got ${actualMode ?? 'none'}`,
      );
    }
    if (
      !(actualUntil instanceof Date) ||
      actualUntil.getTime() < (this.retainUntil?.getTime() ?? 0)
    ) {
      throw new Error(`S3 Object Lock retention is missing or too short for ${key}`);
    }
  }

  private objectKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  private metadataKey(key: string): string {
    return `${this.objectKey(key)}.meta.json`;
  }
}

function normalizePrefix(prefix = ''): string {
  if (!prefix) return '';
  return `${safeKey(prefix.replace(/\/+$/, ''))}/`;
}

function safeKey(key: string): string {
  if (!key || key.includes('\\') || key.includes('\0') || key.startsWith('/')) {
    throw new Error('artifact key must be a relative POSIX path');
  }
  const parts = key.split('/').filter(Boolean);
  if (!parts.length || parts.some((part) => part === '..' || part === '.')) {
    throw new Error('artifact key traversal is not allowed');
  }
  return parts.join('/');
}
