export interface ModelPricing {
  /** USD per million input tokens. */
  input_per_mtok: number;
  /** USD per million output tokens. */
  output_per_mtok: number;
}

/**
 * Default per-model pricing. Override at runtime via BudgetTracker(...).pricing.
 * Numbers are illustrative; production should pull from a vendor-maintained file
 * or the org's contract pricing.
 */
export const defaultPricing: Record<string, ModelPricing> = {
  'claude-opus-4-7': { input_per_mtok: 15, output_per_mtok: 75 },
  'claude-sonnet-4-6': { input_per_mtok: 3, output_per_mtok: 15 },
  'claude-haiku-4-5': { input_per_mtok: 0.8, output_per_mtok: 4 },
  'gpt-4.1': { input_per_mtok: 2, output_per_mtok: 8 },
  'gpt-4o-mini': { input_per_mtok: 0.15, output_per_mtok: 0.6 },
  'gemini-2.0-pro': { input_per_mtok: 2.5, output_per_mtok: 10 },
};
