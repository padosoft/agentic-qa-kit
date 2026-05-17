import type { Scenario } from '@aqa/schemas';

export type ReviewState = 'pending' | 'approved' | 'rejected';

export interface ReviewItem {
  id: string;
  scenario: Scenario.Scenario;
  state: ReviewState;
  created_at: string;
  reviewed_at?: string;
  reviewer?: string;
  rationale?: string;
}

/**
 * Review queue for AI-generated scenarios. Nothing flows into the active
 * profile without an explicit approval — the queue is the human-in-the-loop
 * gate. `approve(id, reviewer)` and `reject(id, reviewer, rationale)` are
 * the only ways to leave the `pending` state.
 */
export class ReviewQueue {
  private items: ReviewItem[] = [];

  enqueue(scenario: Scenario.Scenario, id: string, now: Date = new Date()): ReviewItem {
    const item: ReviewItem = {
      id,
      scenario,
      state: 'pending',
      created_at: now.toISOString(),
    };
    this.items.push(item);
    return item;
  }

  approve(id: string, reviewer: string, now: Date = new Date()): ReviewItem | null {
    return this.transition(id, 'approved', reviewer, undefined, now);
  }

  reject(
    id: string,
    reviewer: string,
    rationale: string,
    now: Date = new Date(),
  ): ReviewItem | null {
    return this.transition(id, 'rejected', reviewer, rationale, now);
  }

  private transition(
    id: string,
    next: ReviewState,
    reviewer: string,
    rationale: string | undefined,
    now: Date,
  ): ReviewItem | null {
    const item = this.items.find((x) => x.id === id);
    if (!item) return null;
    if (item.state !== 'pending') {
      throw new Error(`[generator/queue] cannot transition ${id} from ${item.state} to ${next}`);
    }
    item.state = next;
    item.reviewer = reviewer;
    item.reviewed_at = now.toISOString();
    if (rationale !== undefined) item.rationale = rationale;
    return item;
  }

  list(state?: ReviewState): ReadonlyArray<ReviewItem> {
    return state === undefined ? [...this.items] : this.items.filter((i) => i.state === state);
  }

  approvedScenarios(): ReadonlyArray<Scenario.Scenario> {
    return this.items.filter((i) => i.state === 'approved').map((i) => i.scenario);
  }
}
