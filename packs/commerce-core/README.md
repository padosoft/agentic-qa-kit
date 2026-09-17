# Commerce Core Pack

Commerce assurance scenarios for online stores and agentic commerce systems.

The pack is opt-in: it applies when the project context has one of the tags
`ecommerce`, `commerce`, `shop`, or `storefront`. It does not assume a specific
framework or payment provider.

Coverage includes checkout idempotency, finite-inventory concurrency, money and
currency reconciliation, partial-refund exactly-once behavior, and signed
webhook replay protection. Provider adapters must expose authoritative
observations; an unavailable observer is not a pass.
