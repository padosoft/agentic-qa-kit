# ADR-150: Pin webhook DNS answers at the connection boundary

## Status

Accepted

## Context

The portable fetch transport enforced HTTPS, origin allowlisting, no redirects
and response limits, but a fetch implementation can resolve DNS after the URL
check or resolve a different answer than the one inspected by policy. That is
insufficient for a direct egress boundary exposed to DNS rebinding or private
network targets.

## Decision

Provide `NodePinnedHttpsWebhookTransport`. It resolves all A/AAAA answers once,
rejects the complete set if any address is invalid, private, loopback,
link-local or multicast, and opens a raw HTTPS connection to the selected IP.
The original hostname remains the TLS `servername` and HTTP `Host`; redirects
cannot be followed because the transport does not implement redirect handling.
Response bytes and connection time are bounded.

Portable runtimes may use an egress proxy implementing the same connection-time
policy. `HttpWebhookTransport` remains available for test injection and
runtime environments that already enforce DNS/private-IP policy below fetch.

## Consequences

- DNS rebinding between URL validation and socket creation is removed for the
  Node direct transport.
- Multi-address DNS records are fail-closed if any answer is unsafe, avoiding
  address-selection ambiguity.
- The transport is Node-specific; operators on other runtimes must configure an
  equivalent proxy rather than assuming URL allowlisting is sufficient.
- Tests inject DNS answers and prove denial without external network access.
