export type AdapterTarget = 'claude' | 'codex' | 'gemini' | 'copilot';

export interface RenderContext {
  /** Project name (a Slug). Used in instruction file headers. */
  projectName: string;
  /** Optional one-line project description for instruction file headers. */
  projectDescription?: string;
  /** Repository root, relative paths in rendered files are anchored here. */
  root: string;
}

export interface RenderedFile {
  /** Path relative to `RenderContext.root`. */
  path: string;
  /** Full text contents to write. */
  contents: string;
  /**
   * Suggested file mode. The CLI's install-agent-files command writes these
   * via the existing writeFileSafe helper (overwrite + dry-run semantics).
   */
  kind: 'instruction' | 'skill' | 'agent' | 'hook' | 'config';
}

export interface AdapterCapabilities {
  /** Does the agent host honor in-repo skills (Markdown frontmatter)? */
  skills: boolean;
  /** Does the agent host honor `subagents` / sub-agent prompts? */
  subagents: boolean;
  /** Does the agent host honor hooks (PreToolUse / SessionStart / …)? */
  hooks: boolean;
  /** Canonical instruction filename relative to repo root. */
  instruction_file: string;
}

export interface Adapter {
  target: AdapterTarget;
  capabilities: AdapterCapabilities;
  /** Returns the files to write for this target. Deterministic given the same ctx. */
  render(ctx: RenderContext): RenderedFile[];
}
