# ADR-045: Fail-closed MFA policy enforcement

## Status

Accepted — OIDC assertion and session boundary shipped; local factors remain open.

## Decision

`@aqa/auth` accepts an optional `MfaPolicy`. OIDC maps the configured `amr`
claim (or a custom claim) to `User.mfa_verified` only for accepted methods, and
`OidcSessionManager.complete()` invokes `enforceMfa()` before writing a session.
Policies can apply globally or to selected roles.

## Consequences

An absent or unrecognized IdP factor cannot silently create an authenticated
session when MFA is required. Native TOTP/WebAuthn enrollment, recovery codes,
policy persistence and external-IdP journey verification are not implied by
this boundary and remain roadmap work.
