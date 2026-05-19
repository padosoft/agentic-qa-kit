import { z } from 'zod';
import { Slug } from './common.js';

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
  // has never been installed.
  last_updated: z.string().datetime({ offset: true }).nullable().default(null),
  // Project-root-relative paths the install materializes. Empty arrays
  // are allowed so a scaffold-only agent can declare itself before its
  // files are authored.
  files: z.array(z.string().min(1)).default([]),
});
export type Agent = z.infer<typeof Agent>;
