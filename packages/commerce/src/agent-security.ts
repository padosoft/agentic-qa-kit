import { z } from 'zod';

const ToolMoney = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  amount_minor: z.string().regex(/^(0|[1-9]\d*)$/),
});

export const CommerceToolCall = z.object({
  schema_version: z.literal('1'),
  id: z.string().min(1),
  tenant: z.string().min(1),
  customer_id: z.string().min(1),
  tool: z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/),
  operation: z.enum(['read', 'write', 'financial']),
  target: z.object({ tenant: z.string().min(1), customer_id: z.string().min(1) }),
  cart_revision: z.number().int().nonnegative().optional(),
  total: ToolMoney.optional(),
  requested_at: z.string().datetime({ offset: true }),
});
export type CommerceToolCall = z.infer<typeof CommerceToolCall>;

export const HumanCommerceApproval = z.object({
  schema_version: z.literal('1'),
  approval_id: z.string().min(1),
  call_id: z.string().min(1),
  tenant: z.string().min(1),
  customer_id: z.string().min(1),
  cart_revision: z.number().int().nonnegative(),
  total: ToolMoney,
  approved_by: z.string().min(1),
  source: z.literal('human'),
  expires_at: z.string().datetime({ offset: true }),
});
export type HumanCommerceApproval = z.infer<typeof HumanCommerceApproval>;

export type CommerceAuthorization =
  | { allowed: true; reason: 'read_allowed' | 'human_approval_allowed' }
  | { allowed: false; reason: string };

export type CommerceToolPolicyOptions = {
  read_tools: readonly string[];
  now?: () => Date;
};

/**
 * Fail-closed policy boundary for agentic commerce tools.
 *
 * The class is intentionally provider-neutral: a real gateway must still
 * enforce the returned decision atomically with the merchant mutation.
 */
export class CommerceToolPolicy {
  private readonly readTools: ReadonlySet<string>;
  private readonly now: () => Date;
  private readonly consumedApprovals = new Set<string>();

  constructor(options: CommerceToolPolicyOptions) {
    if (options.read_tools.length === 0) throw new Error('read_tools must not be empty');
    this.readTools = new Set(options.read_tools);
    this.now = options.now ?? (() => new Date());
  }

  authorize(call: CommerceToolCall, approval?: HumanCommerceApproval): CommerceAuthorization {
    const parsedCall = CommerceToolCall.safeParse(call);
    if (!parsedCall.success) return { allowed: false, reason: 'invalid_tool_call' };
    const item = parsedCall.data;
    if (item.target.tenant !== item.tenant || item.target.customer_id !== item.customer_id)
      return { allowed: false, reason: 'cross_customer_or_tenant_target' };
    if (item.operation === 'read') {
      return this.readTools.has(item.tool)
        ? { allowed: true, reason: 'read_allowed' }
        : { allowed: false, reason: 'read_tool_not_allowlisted' };
    }
    if (!approval) return { allowed: false, reason: 'human_approval_required' };
    const parsedApproval = HumanCommerceApproval.safeParse(approval);
    if (!parsedApproval.success) return { allowed: false, reason: 'invalid_human_approval' };
    const grant = parsedApproval.data;
    if (this.consumedApprovals.has(grant.approval_id))
      return { allowed: false, reason: 'approval_already_consumed' };
    if (
      grant.call_id !== item.id ||
      grant.tenant !== item.tenant ||
      grant.customer_id !== item.customer_id
    )
      return { allowed: false, reason: 'approval_binding_mismatch' };
    if (Date.parse(grant.expires_at) <= this.now().getTime())
      return { allowed: false, reason: 'approval_expired' };
    if (item.cart_revision === undefined || item.total === undefined)
      return { allowed: false, reason: 'cart_revision_and_total_required' };
    if (grant.cart_revision !== item.cart_revision || !sameMoney(grant.total, item.total))
      return { allowed: false, reason: 'approval_stale_or_total_mismatch' };
    this.consumedApprovals.add(grant.approval_id);
    return { allowed: true, reason: 'human_approval_allowed' };
  }
}

function sameMoney(left: z.infer<typeof ToolMoney>, right: z.infer<typeof ToolMoney>): boolean {
  return left.currency === right.currency && left.amount_minor === right.amount_minor;
}
