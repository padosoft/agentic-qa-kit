# Artifact provider evidence

The manual `artifact-provider-evidence.yml` workflow exercises an
operator-owned S3-compatible endpoint. It creates an isolated Object Lock
bucket, writes a redacted artifact and metadata sidecar, reads both back, and
verifies the provider's retention state and optional server-side encryption
identity through `HeadObject`.

Use the protected GitHub Environment `production-artifact-evidence` and
configure:

- Variables: `AQA_TEST_S3_ENDPOINT`, `AWS_REGION`,
  `AQA_TEST_S3_RETENTION_MODE`, `AQA_TEST_S3_RETENTION_HOURS`;
- Optional variables: `AQA_TEST_S3_SERVER_SIDE_ENCRYPTION` (`AES256`,
  `aws:kms` or `aws:kms:dsse`) and `AQA_TEST_S3_SSE_KMS_KEY_ID`;
- Secrets: `AQA_TEST_S3_ACCESS_KEY_ID` and
  `AQA_TEST_S3_SECRET_ACCESS_KEY`.

The workflow fails closed if required configuration is absent or a KMS mode
has no exact key identity. Credentials are injected into the SDK only; they
are never printed or written to evidence. The journey does not claim key
rotation, IAM review, replication, backup/PITR or disaster-recovery RTO/RPO.
Those remain separate operator exercises.

The regular CI job uses MinIO with synthetic credentials and remains a
provider-compatible contract check. It is not evidence for an AWS or
production tenant.
