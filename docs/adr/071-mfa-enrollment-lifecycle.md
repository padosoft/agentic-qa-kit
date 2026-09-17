# ADR-071 — MFA enrollment and recovery lifecycle boundary

## Status

Accepted — 2026-09-17

## Decision

Add a provider-neutral `MfaLifecycle` in `@aqa/auth`. Enrollment generates a random TOTP secret and recovery codes, but no credential is enabled until a valid TOTP confirmation is supplied. The lifecycle accepts an injected `MfaSecretProtector` and `MfaCredentialStore`; it never requires or silently falls back to plaintext secret persistence. Recovery codes are hashed and consumed one at a time.

## Rationale

The existing RFC 6238 verifier and IdP MFA enforcement covered authentication checks but not the credential lifecycle. Keeping protection and persistence behind explicit interfaces makes the security boundary testable without pretending that an in-memory map or an application-level wrapper is a KMS/Vault implementation.

## Evidence and limits

- `packages/auth/test/mfa-lifecycle.test.ts` proves enrollment confirmation, protected storage boundary and one-time recovery consumption.
- `PostgresMfaCredentialStore` supplies the durable composite `(tenant_id, user_id)` persistence boundary; its integration contract is skipped unless `AQA_TEST_POSTGRES_DSN` is configured.
- Production still requires a durable tenant/user-scoped credential store, envelope encryption with KMS/Vault, audit events, abuse/rate limits, and WebAuthn/passkey support.
