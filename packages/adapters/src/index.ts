export type { Adapter, AdapterTarget, RenderContext, RenderedFile } from './types.js';
export { claudeAdapter } from './claude.js';
export { codexAdapter } from './codex.js';
export { geminiAdapter } from './gemini.js';
export { copilotAdapter } from './copilot.js';
export { adapters, adapterByTarget } from './registry.js';
export { renderForTargets } from './render.js';
