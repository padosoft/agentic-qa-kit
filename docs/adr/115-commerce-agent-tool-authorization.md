# ADR-115: commerce agent tool authorization

- Status: Accepted
- Date: 2026-09-17

## Decision

Add a provider-neutral `CommerceToolPolicy`. Read tools must be explicitly
allowlisted and target the same tenant/customer as the caller. Write and
financial operations require a `HumanCommerceApproval` whose call ID, tenant,
customer, cart revision, exact minor-unit total/currency and expiry match the
request. Approvals are consumed once by the policy instance; malformed,
cross-tenant, stale, expired or replayed approvals fail closed.

## Consequences

- Prompt injection cannot grant spend authority by itself.
- The contract covers the authorization decision, not the durable approval
  store or provider transaction; production must enforce it atomically at the
  tool gateway and reconcile external effects.
- Human approval may not be reused after a cart revision or total changes.

## Verification

Commerce build/typecheck and **21 tests** pass locally. Live merchant gateway,
durable approval persistence and provider reconciliation remain open.
