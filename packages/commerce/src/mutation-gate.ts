import type {
  CommerceAuthorization,
  CommerceToolCall,
  CommerceToolPolicy,
  HumanCommerceApproval,
} from './agent-security.js';

export type CommerceMutationExecution<T> =
  | { status: 'committed'; value: T }
  | { status: 'not_committed'; reason: string }
  | { status: 'unknown'; reason: string };

export type CommerceMutationGateResult<T> =
  | { status: 'denied'; authorization: Extract<CommerceAuthorization, { allowed: false }> }
  | {
      status: 'committed';
      authorization: Extract<CommerceAuthorization, { allowed: true }>;
      value: T;
    }
  | {
      status: 'not_committed';
      authorization: Extract<CommerceAuthorization, { allowed: true }>;
      reason: string;
    }
  | {
      status: 'unknown';
      authorization: Extract<CommerceAuthorization, { allowed: true }>;
      reason: string;
    };

export type CommerceMutationExecutor<T> = (input: {
  call: CommerceToolCall;
  approval: HumanCommerceApproval;
}) => Promise<CommerceMutationExecution<T>>;

/**
 * The mandatory application boundary for agent-initiated commerce writes.
 *
 * The executor must perform the cart revision/total check and merchant
 * mutation in one provider transaction (or an equivalent idempotent protocol).
 * An ambiguous transport failure is `unknown`, never `not_committed`; the
 * approval remains claimed and the caller must reconcile before retrying.
 */
export class CommerceMutationGate {
  constructor(private readonly policy: CommerceToolPolicy) {}

  async execute<T>(
    call: CommerceToolCall,
    approval: HumanCommerceApproval | undefined,
    executor: CommerceMutationExecutor<T>,
  ): Promise<CommerceMutationGateResult<T>> {
    const authorization = await this.policy.authorizeAsync(call, approval);
    if (!authorization.allowed) return { status: 'denied', authorization };
    if (!approval) {
      return {
        status: 'denied',
        authorization: { allowed: false, reason: 'human_approval_required' },
      };
    }
    try {
      const execution = await executor({ call, approval });
      if (execution.status === 'committed') return { ...execution, authorization };
      return { ...execution, authorization };
    } catch {
      // A thrown error may mean the provider committed before the response was
      // lost. Keep the durable approval claim and force reconciliation.
      return {
        status: 'unknown',
        authorization,
        reason: 'merchant_mutation_outcome_unknown',
      };
    }
  }
}
