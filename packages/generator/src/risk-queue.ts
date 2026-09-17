import type { RiskMap } from '@aqa/schemas';

export type RiskReviewState = 'pending' | 'approved' | 'rejected';

export interface RiskGenerationProvenance {
  provider: string;
  model: string;
  model_version_hash?: string;
  prompt_sha256: string;
  response_sha256: string;
}

export interface RiskReviewItem {
  id: string;
  risk: RiskMap.Risk;
  state: RiskReviewState;
  created_at: string;
  reviewed_at?: string;
  reviewer?: string;
  rationale?: string;
  provenance: RiskGenerationProvenance;
}

/** Human gate for AI risk hypotheses; nothing is written to a RiskMap here. */
export class RiskReviewQueue {
  private items: RiskReviewItem[] = [];

  enqueue(
    risk: RiskMap.Risk,
    id: string,
    provenance: RiskGenerationProvenance,
    now: Date = new Date(),
  ): RiskReviewItem {
    const item: RiskReviewItem = {
      id,
      risk,
      state: 'pending',
      created_at: now.toISOString(),
      provenance,
    };
    this.items.push(item);
    return item;
  }

  approve(id: string, reviewer: string, now: Date = new Date()): RiskReviewItem | null {
    return this.transition(id, 'approved', reviewer, undefined, now);
  }

  reject(
    id: string,
    reviewer: string,
    rationale: string,
    now: Date = new Date(),
  ): RiskReviewItem | null {
    return this.transition(id, 'rejected', reviewer, rationale, now);
  }

  list(state?: RiskReviewState): ReadonlyArray<RiskReviewItem> {
    return state === undefined
      ? [...this.items]
      : this.items.filter((item) => item.state === state);
  }

  approvedRisks(): ReadonlyArray<RiskMap.Risk> {
    return this.items.filter((item) => item.state === 'approved').map((item) => item.risk);
  }

  private transition(
    id: string,
    next: RiskReviewState,
    reviewer: string,
    rationale: string | undefined,
    now: Date,
  ): RiskReviewItem | null {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item) return null;
    if (item.state !== 'pending')
      throw new Error(
        `[generator/risk-queue] cannot transition ${id} from ${item.state} to ${next}`,
      );
    if (!reviewer.trim()) throw new Error('[generator/risk-queue] reviewer is required');
    item.state = next;
    item.reviewer = reviewer;
    item.reviewed_at = now.toISOString();
    if (rationale !== undefined) item.rationale = rationale;
    return item;
  }
}
