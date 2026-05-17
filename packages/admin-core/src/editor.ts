export interface OptimisticChange<T> {
  /** Unique id; the caller chooses how to mint it. */
  id: string;
  /** The next value after applying this change. */
  next: T;
}

export interface OptimisticState<T> {
  base: T;
  pending: ReadonlyArray<OptimisticChange<T>>;
  committed: ReadonlyArray<OptimisticChange<T>>;
  effective: T;
}

/**
 * Headless optimistic editor. The admin UI sets `base` from the server,
 * then `propose` lays a change on top. `commit` resolves the change against
 * the server (in real code, calls the API and writes the result); `rollback`
 * undoes a failed proposal.
 *
 * The state is intentionally immutable so React + Zustand consumers can do
 * structural sharing without surprise.
 */
export class OptimisticEditor<T> {
  private state: OptimisticState<T>;

  constructor(base: T) {
    this.state = { base, pending: [], committed: [], effective: base };
  }

  snapshot(): OptimisticState<T> {
    return this.state;
  }

  propose(change: OptimisticChange<T>): OptimisticState<T> {
    this.state = {
      ...this.state,
      pending: [...this.state.pending, change],
      effective: change.next,
    };
    return this.state;
  }

  commit(id: string): OptimisticState<T> {
    const idx = this.state.pending.findIndex((c) => c.id === id);
    if (idx === -1) return this.state;
    const change = this.state.pending[idx];
    if (!change) return this.state;
    this.state = {
      base: change.next,
      pending: this.state.pending.filter((c) => c.id !== id),
      committed: [...this.state.committed, change],
      effective: change.next,
    };
    return this.state;
  }

  rollback(id: string): OptimisticState<T> {
    const remaining = this.state.pending.filter((c) => c.id !== id);
    const effective =
      remaining.length === 0 ? this.state.base : (remaining[remaining.length - 1]?.next as T);
    this.state = { ...this.state, pending: remaining, effective };
    return this.state;
  }
}
