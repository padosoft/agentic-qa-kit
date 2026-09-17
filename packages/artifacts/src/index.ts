import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { redactJson, redactText } from '@aqa/observability';

export interface ArtifactRef {
  id: string;
  key: string;
  sha256: string;
  bytes: number;
  content_type: string;
  redacted: boolean;
  created_at: string;
}

export interface ArtifactStore {
  putText(key: string, value: string, contentType?: string): Promise<ArtifactRef>;
  putJson(key: string, value: unknown): Promise<ArtifactRef>;
  putBytes(key: string, value: Uint8Array, contentType?: string): Promise<ArtifactRef>;
  get(ref: ArtifactRef): Promise<Uint8Array>;
  delete(ref: ArtifactRef): Promise<void>;
}

export { S3ArtifactStore } from './s3.js';
export type { S3ArtifactClient, S3ArtifactStoreOptions } from './s3.js';

export { redactJson, redactText } from '@aqa/observability';

function safeKey(key: string): string {
  if (
    !key ||
    isAbsolute(key) ||
    key.includes('\\') ||
    key.split('/').some((part) => part === '..')
  ) {
    throw new Error('artifact key must be a relative POSIX path without parent traversal');
  }
  const normalized = key.split('/').filter(Boolean).join('/');
  if (!normalized || normalized.startsWith('.') || normalized.includes('\0')) {
    throw new Error('artifact key is invalid');
  }
  return normalized;
}

export class FileArtifactStore implements ArtifactStore {
  constructor(private readonly root: string) {}

  async putText(key: string, value: string, contentType = 'text/plain; charset=utf-8') {
    return this.putBytesInternal(key, Buffer.from(redactText(value), 'utf8'), contentType, true);
  }

  async putJson(key: string, value: unknown) {
    const body = JSON.stringify(redactJson(value));
    return this.putBytesInternal(key, Buffer.from(`${body}\n`, 'utf8'), 'application/json', true);
  }

  async putBytes(key: string, value: Uint8Array, contentType = 'application/octet-stream') {
    return this.putBytesInternal(key, value, contentType, false);
  }

  /** Synchronous variant for synchronous CLI commands such as `aqa report`. */
  putTextSync(key: string, value: string, contentType = 'text/plain; charset=utf-8') {
    return this.putBytesSyncInternal(
      key,
      Buffer.from(redactText(value), 'utf8'),
      contentType,
      true,
    );
  }

  putJsonSync(key: string, value: unknown) {
    const body = JSON.stringify(redactJson(value));
    return this.putBytesSyncInternal(
      key,
      Buffer.from(`${body}\n`, 'utf8'),
      'application/json',
      true,
    );
  }

  async get(ref: ArtifactRef): Promise<Uint8Array> {
    return readFile(this.pathFor(ref.key));
  }

  async delete(ref: ArtifactRef): Promise<void> {
    await Promise.all([
      rm(this.pathFor(ref.key), { force: true }),
      rm(this.metaPath(ref.key), { force: true }),
    ]);
  }

  private pathFor(key: string): string {
    const clean = safeKey(key);
    const candidate = join(this.root, clean);
    const rel = relative(this.root, candidate);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
      throw new Error('artifact path escaped root');
    return candidate;
  }

  private metaPath(key: string): string {
    return `${this.pathFor(key)}.meta.json`;
  }

  private async putBytesInternal(
    key: string,
    value: Uint8Array,
    contentType: string,
    redacted: boolean,
  ) {
    const clean = safeKey(key);
    const target = this.pathFor(clean);
    const bytes = Buffer.from(value);
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
    await mkdir(dirname(target), { recursive: true });
    const temp = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, bytes, { flag: 'wx' });
      await rename(temp, target);
      await writeFile(this.metaPath(clean), `${JSON.stringify(ref)}\n`, { encoding: 'utf8' });
    } finally {
      await rm(temp, { force: true });
    }
    return ref;
  }

  private putBytesSyncInternal(
    key: string,
    value: Uint8Array,
    contentType: string,
    redacted: boolean,
  ) {
    const clean = safeKey(key);
    const target = this.pathFor(clean);
    const bytes = Buffer.from(value);
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
    mkdirSync(dirname(target), { recursive: true });
    const temp = `${target}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temp, bytes, { flag: 'wx' });
      renameSync(temp, target);
      writeFileSync(this.metaPath(clean), `${JSON.stringify(ref)}\n`, 'utf8');
    } finally {
      rmSync(temp, { force: true });
    }
    return ref;
  }
}
