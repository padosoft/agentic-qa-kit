import { z } from 'zod';
import { IsoDateTime, Slug } from './common.js';

// A repo-relative file path that an Agent install is allowed to
// materialize. Rejects:
//   - absolute paths (leading `/`, drive letters, UNC)
//   - any `..` segment (parent traversal)
//   - the literal `..` filename
// to prevent path-traversal attacks via a malicious or compromised
// adapter declaration. Trailing/leading whitespace is also rejected
// (a file name with stray whitespace is almost always a typo).
const SafeRepoPath = z
  .string()
  .min(1)
  .max(255)
  .refine((s) => s === s.trim() && s.length > 0, 'must not have leading/trailing whitespace')
  .refine(
    // Reject leading `/` or `\`, ANY Windows drive-letter prefix
    // (`C:foo`, `C:/foo`, `C:\foo` — drive-relative is just as
    // dangerous as absolute on Windows), and UNC roots (`\\srv\…`).
    // PR #38 Copilot iter 6.
    (s) => !/^[/\\]/.test(s) && !/^[A-Za-z]:/.test(s) && !/^\\\\/.test(s),
    'must be relative (no leading `/`, `\\`, drive letter, or UNC root)',
  )
  .refine(
    (s) => !s.split(/[/\\]/).some((seg) => seg === '..'),
    'must not contain `..` path segments',
  );

// AI agent adapter — represents a configurable client like Claude
// Code, Codex CLI, Gemini CLI, GitHub Copilot. The admin's Agents page
// renders one card per agent and exposes install/uninstall actions
// that materialize the adapter's files (skills, agents, instructions
// docs) in the project root.
export const Agent = z.object({
  schema_version: z.literal('1'),
  id: Slug,
  name: z.string().min(2).max(120),
  vendor: z.string().min(2).max(120),
  installed: z.boolean().default(false),
  // ISO timestamp of the last install/upgrade — null when the agent
  // has never been installed. Reuses the shared IsoDateTime so all
  // schemas share the same datetime validation/error messages.
  last_updated: IsoDateTime.nullable().default(null),
  // Project-root-relative paths the install materializes. Validated
  // as SafeRepoPath so install hooks can't be tricked into writing
  // outside the project root (PR #38 Copilot iter 3). Empty arrays
  // are allowed so a scaffold-only agent can declare itself before
  // its files are authored.
  files: z.array(SafeRepoPath).default([]),
});
export type Agent = z.infer<typeof Agent>;
