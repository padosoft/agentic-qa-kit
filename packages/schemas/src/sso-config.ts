import { z } from 'zod';

export const SsoConfig = z.object({
  schema_version: z.literal('1'),
  provider: z.literal('oidc'),
  enabled: z.boolean(),
  issuer_url: z.string().url(),
  client_id: z.string().min(1),
  // The actual client secret never crosses the wire; this flag only
  // says whether a secret exists in the server's secret store.
  client_secret_set: z.boolean(),
  allowed_email_domains: z.array(z.string().min(1)).default([]),
  claim_mappings: z.record(z.string().min(1), z.string().min(1)),
});

export type SsoConfig = z.infer<typeof SsoConfig>;
