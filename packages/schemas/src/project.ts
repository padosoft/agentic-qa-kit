import { z } from 'zod';
import { SemVer, Slug } from './common.js';

export const Project = z.object({
  schema_version: z.literal('1'),
  name: Slug,
  version: SemVer.optional(),
  description: z.string().max(500).optional(),
  stack: z.object({
    runtime: z.enum(['bun', 'node', 'deno', 'python', 'jvm', 'go', 'ruby', 'php', 'dotnet']),
    framework: z.string().optional(),
    db: z.array(z.string()).default([]),
    test_runner: z.string().optional(),
    package_manager: z
      .enum(['bun', 'npm', 'pnpm', 'yarn', 'pip', 'poetry', 'maven', 'gradle'])
      .optional(),
  }),
  sut: z.object({
    type: z.enum(['api', 'web', 'cli', 'lib', 'agent', 'pipeline']),
    base_url: z.string().url().optional(),
    repo: z.string().optional(),
  }),
  tags: z.array(z.string()).default([]),
});
export type Project = z.infer<typeof Project>;
