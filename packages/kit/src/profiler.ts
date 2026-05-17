import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const FRAMEWORK_SIGNALS: Array<{ pkg: string; name: string }> = [
  { pkg: 'next', name: 'next.js' },
  { pkg: 'hono', name: 'hono' },
  { pkg: 'express', name: 'express' },
  { pkg: 'fastify', name: 'fastify' },
  { pkg: 'koa', name: 'koa' },
  { pkg: 'remix', name: 'remix' },
  { pkg: 'astro', name: 'astro' },
  { pkg: '@nestjs/core', name: 'nestjs' },
  { pkg: 'vue', name: 'vue' },
  { pkg: 'svelte', name: 'svelte' },
];

const DB_SIGNALS: Array<{ pkg: string; name: string }> = [
  { pkg: 'pg', name: 'postgres' },
  { pkg: 'postgres', name: 'postgres' },
  { pkg: 'mysql2', name: 'mysql' },
  { pkg: 'mysql', name: 'mysql' },
  { pkg: 'sqlite3', name: 'sqlite' },
  { pkg: 'better-sqlite3', name: 'sqlite' },
  { pkg: 'mongodb', name: 'mongodb' },
  { pkg: 'redis', name: 'redis' },
  { pkg: 'ioredis', name: 'redis' },
  { pkg: '@prisma/client', name: 'prisma' },
  { pkg: 'drizzle-orm', name: 'drizzle' },
];

const LLM_SIGNALS: Array<{ pkg: string; name: string }> = [
  { pkg: '@anthropic-ai/sdk', name: 'anthropic' },
  { pkg: 'openai', name: 'openai' },
  { pkg: '@google/genai', name: 'google-genai' },
  { pkg: '@google-ai/generativelanguage', name: 'google-genai' },
  { pkg: 'cohere-ai', name: 'cohere' },
  { pkg: 'ollama', name: 'ollama' },
];

const TEST_RUNNER_SIGNALS: Array<{ pkg: string; name: string }> = [
  { pkg: 'vitest', name: 'vitest' },
  { pkg: 'jest', name: 'jest' },
  { pkg: 'mocha', name: 'mocha' },
  { pkg: '@playwright/test', name: 'playwright' },
  { pkg: 'cypress', name: 'cypress' },
];

export interface ProjectProfile {
  runtime: 'bun' | 'node' | 'deno' | 'unknown';
  package_manager: 'bun' | 'pnpm' | 'npm' | 'yarn' | 'unknown';
  framework: string | null;
  db: string[];
  llm: string[];
  test_runner: string | null;
  sut_type: 'api' | 'web' | 'cli' | 'lib' | 'agent' | 'unknown';
  has_aqa: boolean;
}

interface PackageJsonLike {
  name?: unknown;
  bin?: unknown;
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  peerDependencies?: Record<string, unknown>;
}

function readPackageJson(root: string): PackageJsonLike | null {
  try {
    const raw = readFileSync(join(root, 'package.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as PackageJsonLike) : null;
  } catch {
    return null;
  }
}

function fileExists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function detectRuntime(root: string): ProjectProfile['runtime'] {
  if (fileExists(join(root, 'bunfig.toml')) || fileExists(join(root, 'bun.lock'))) return 'bun';
  if (fileExists(join(root, 'deno.json')) || fileExists(join(root, 'deno.jsonc'))) return 'deno';
  if (fileExists(join(root, 'package.json'))) return 'node';
  return 'unknown';
}

function detectPackageManager(root: string): ProjectProfile['package_manager'] {
  if (fileExists(join(root, 'bun.lock'))) return 'bun';
  if (fileExists(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fileExists(join(root, 'yarn.lock'))) return 'yarn';
  if (fileExists(join(root, 'package-lock.json'))) return 'npm';
  return 'unknown';
}

function detectByDeps<T extends { pkg: string; name: string }>(
  pkg: PackageJsonLike | null,
  table: T[],
): string[] {
  if (!pkg) return [];
  const all: Record<string, unknown> = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
    ...(pkg.peerDependencies ?? {}),
  };
  const found = new Set<string>();
  for (const { pkg: p, name } of table) {
    if (p in all) found.add(name);
  }
  return [...found];
}

function detectSutType(root: string, pkg: PackageJsonLike | null): ProjectProfile['sut_type'] {
  if (pkg?.bin) return 'cli';
  const hasNext =
    fileExists(join(root, 'next.config.js')) || fileExists(join(root, 'next.config.ts'));
  if (hasNext) return 'web';
  const hasIndexHtml =
    fileExists(join(root, 'index.html')) || fileExists(join(root, 'public', 'index.html'));
  if (hasIndexHtml) return 'web';
  if (fileExists(join(root, 'src', 'app.ts')) || fileExists(join(root, 'src', 'server.ts')))
    return 'api';
  if (pkg?.name && typeof pkg.name === 'string' && /agent|llm|chat/i.test(pkg.name)) return 'agent';
  return 'unknown';
}

export function profileRepo(root: string): ProjectProfile {
  const pkg = readPackageJson(root);
  const framework = detectByDeps(pkg, FRAMEWORK_SIGNALS)[0] ?? (pkg ? null : null);
  return {
    runtime: detectRuntime(root),
    package_manager: detectPackageManager(root),
    framework: framework ?? null,
    db: detectByDeps(pkg, DB_SIGNALS),
    llm: detectByDeps(pkg, LLM_SIGNALS),
    test_runner: detectByDeps(pkg, TEST_RUNNER_SIGNALS)[0] ?? null,
    sut_type: detectSutType(root, pkg),
    has_aqa: hasAqaDir(root),
  };
}

function hasAqaDir(root: string): boolean {
  try {
    const entries = readdirSync(root);
    return entries.includes('.aqa');
  } catch {
    return false;
  }
}
