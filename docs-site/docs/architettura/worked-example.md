---
title: Worked Example
description: A complete cross-tenant data leak QA example.
---

# Worked Example

This example models a cross-tenant read risk in a SaaS API.

::: steps
1. **Risk**
   One tenant can read another tenant's records.
2. **Invariant**
   A request scoped to tenant A never returns tenant B records.
3. **Scenario**
   Create two tenants, seed records, authenticate as tenant A, then query tenant B identifiers.
4. **Probe**
   Send HTTP requests that vary tenant headers, path IDs, and query filters.
5. **Oracle**
   Fail if any tenant B identifier appears in a tenant A response.
6. **Replay**
   Write the minimal `curl` sequence that reproduces the leak.
:::

## Example oracle

```typescript
const leaked = response.records.some((record) => record.tenantId !== actorTenantId);
if (leaked) {
  fail("Cross-tenant record returned to scoped actor");
}
```

::: callout success "Good finding" icon:badge-check
A useful finding names the invariant, includes the exact request sequence, and explains why the replay proves the bug.
:::
