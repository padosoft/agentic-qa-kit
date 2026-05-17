import { claudeAdapter } from './claude.js';
import { codexAdapter } from './codex.js';
import { copilotAdapter } from './copilot.js';
import { geminiAdapter } from './gemini.js';
import type { Adapter, AdapterTarget } from './types.js';

export const adapters: readonly Adapter[] = [
  claudeAdapter,
  codexAdapter,
  geminiAdapter,
  copilotAdapter,
];

export function adapterByTarget(target: AdapterTarget): Adapter {
  const a = adapters.find((x) => x.target === target);
  if (!a) throw new Error(`[adapters] unknown target "${target}"`);
  return a;
}
