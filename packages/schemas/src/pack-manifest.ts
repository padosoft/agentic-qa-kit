import { z } from 'zod';
import { SemVer, Sha256, Slug, Url } from './common.js';

export const PackAppliesWhen = z
  .object({
    runtime: z.array(z.string()).optional(),
    framework: z.array(z.string()).optional(),
    db: z.array(z.string()).optional(),
    sut_type: z.array(z.string()).optional(),
    tags_any: z.array(z.string()).optional(),
    tags_all: z.array(z.string()).optional(),
  })
  .strict();
export type PackAppliesWhen = z.infer<typeof PackAppliesWhen>;

export const PackManifest = z.object({
  schema_version: z.literal('1'),
  name: Slug,
  version: SemVer,
  description: z.string().max(500),
  author: z.string(),
  license: z.string().default('Apache-2.0'),
  homepage: Url.optional(),
  applies_when: PackAppliesWhen.default({}),
  templates: z.array(z.string()).default([]),
  scenarios: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  oracles: z.array(z.string()).default([]),
  probes: z.array(z.string()).default([]),
  signing: z
    .object({
      sigstore_bundle: z.string().optional(),
      sha256: Sha256,
    })
    .optional(),
});
export type PackManifest = z.infer<typeof PackManifest>;
