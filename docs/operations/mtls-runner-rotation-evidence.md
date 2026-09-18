# mTLS and runner token rotation evidence

The manual `mtls-runner-rotation-evidence.yml` workflow exercises the deployed
identity boundary through the protected `production-identity-evidence`
Environment:

1. a client certificate/key signed by the configured trust root reaches the
   HTTPS health endpoint;
2. the pre-rotation runner bearer token is rejected with HTTP 401 or 403; and
3. the newly issued runner token is accepted with a 2xx response.

Configure the Environment variables `AQA_TEST_MTLS_HEALTH_URL`,
`AQA_TEST_RUNNER_ROTATION_URL` and optional expected status values. Store the
CA, client certificate, private key and both short-lived runner tokens only as
the secrets `AQA_TEST_MTLS_CA_PEM`, `AQA_TEST_MTLS_CERT_PEM`,
`AQA_TEST_MTLS_KEY_PEM`, `AQA_TEST_RUNNER_OLD_TOKEN` and
`AQA_TEST_RUNNER_NEW_TOKEN`.

The journey requires HTTPS URLs without credentials/query data, writes
certificate material only to a mode-700 temporary directory, disables
redirects, never prints response bodies or credentials, and removes the
temporary directory on every path. It proves the configured deployment
boundary, not IdP issuance, certificate-authority governance, revocation-list
propagation, Kubernetes Secret propagation, HA failover or compliance
attestation.
