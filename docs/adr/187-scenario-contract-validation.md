# ADR-187: Validate executable probe and oracle contracts before execution

## Context

The runner must fail closed, but discovering malformed HTTP probe fields or
incomplete response comparators only at execution time still allows invalid
packs to pass parsing and reach runtime. That creates late feedback and makes
pack validation depend on which driver happens to execute first.

## Decision

The `Scenario` Zod validator rejects malformed executable contracts before a
scenario is handed to a runner:

- HTTP probes may declare only `method`, `url`, `headers`, `body`, and `auth`.
- `auth` must be a named host-secret reference such as `${TOKEN}`.
- HTTP headers must be an object whose values are strings.
- `http_status.with.expected` must be numeric.
- `response_contains` must use either a string `value`, or a bounded JSONPath
  beginning with `$.` together with `equals`.
- The same HTTP probe rules apply to cleanup steps.

Runtime Zod validation remains authoritative for these cross-field invariants.
The generated JSON Schema continues to describe the portable structural
contract; provider-specific semantics and secret availability remain runtime
concerns.

## Consequences

Malformed packs fail during load/preflight with paths pointing to the invalid
field. Existing extensibility for non-HTTP probe kinds is preserved. The
runner's fail-closed checks remain defense in depth rather than the first line
of contract validation.
