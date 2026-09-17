# ADR-117: WebAuthn passkey lifecycle boundary

## Status

Accepted

## Context

Enterprise tenants need phishing-resistant authentication for operators and
merchant administrators. A passkey flow must not trust browser-provided user,
origin, RP or approval state, and a challenge must not be replayable across
replicas. Authenticators also differ: some expose a monotonic signature counter
and some intentionally report a counterless credential.

## Decision

Add `WebAuthnLifecycle` to `@aqa/auth` with injected challenge and credential
stores plus an injected standards-compliant signature verifier. The lifecycle:

- requires a valid HTTPS origin and bounded challenge TTL;
- creates cryptographically random challenge identifiers and challenge values;
- consumes challenges before verification, making replay fail closed;
- binds the assertion to user, origin, RP ID and credential;
- requires a strictly increasing counter for counter-supported credentials;
- permits counterless credentials only with the one-time challenge and signature;
- never persists private keys or raw authenticator secrets.

The memory stores are test/reference implementations. Production deployments
must provide durable, atomic stores and a maintained WebAuthn verifier, then
prove the browser/provider journey with Playwright and a real passkey-capable
environment.

## Consequences

This gives callers a narrow security boundary and avoids coupling the auth
package to a browser or crypto vendor. It does not by itself implement
registration ceremonies, attestation policy, browser automation, recovery,
credential revocation or HSM/KMS key management; those remain explicit
integration work rather than being silently represented as complete.
