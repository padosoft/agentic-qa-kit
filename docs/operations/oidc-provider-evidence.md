# OIDC provider evidence

The manual `oidc-provider-evidence.yml` workflow runs the complete provider
identity boundary against an operator-owned IdP:

1. discovers the issuer configuration and validates endpoint origin policy;
2. creates the exact PKCE authorization URL and checks state inputs;
3. exchanges a fresh, single-use authorization code with the client secret;
4. validates the RS256 ID-token issuer, audience, nonce, time claims and JWKS
   signature; and
5. fetches UserInfo over the provider access token and verifies subject,
   email, role and optional MFA claims.

Configure the protected GitHub Environment `production-identity-evidence` with
variables `AQA_TEST_OIDC_ISSUER`, `AQA_TEST_OIDC_CLIENT_ID` and
`AQA_TEST_OIDC_REDIRECT_URI`; optionally configure endpoint origins, expected
role and `AQA_TEST_OIDC_EXPECT_MFA=true`. Configure secrets
`AQA_TEST_OIDC_AUTHORIZATION_CODE`, `AQA_TEST_OIDC_NONCE`,
`AQA_TEST_OIDC_CODE_VERIFIER` and `AQA_TEST_OIDC_CLIENT_SECRET`.

The authorization code must be freshly issued for the configured redirect URI,
client and PKCE verifier immediately before the manual run. It is consumed by
the IdP and is never printed or stored by the test. Use a dedicated synthetic
identity; never use a customer or administrator credential.

A passing run proves this configured authorization-code path at that time. It
does not prove SCIM provisioning, logout/session-cookie behavior, certificate
rotation, mTLS, load-balancer failover or IdP availability objectives.
