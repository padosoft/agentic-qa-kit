# PostgreSQL recovery provider evidence

The manual `postgres-recovery-provider-evidence.yml` workflow connects to an
operator-owned, isolated PostgreSQL recovery target and runs only the
SELECT-based `observePostgresRecoveryAtDsn()` probe. It requires both
`pg_is_in_recovery()` and `transaction_read_only=on`, optionally pins the
server major version and replay LSN, and closes the connection in the adapter.

Set the disposable recovery-target DSN only as the protected
`AQA_TEST_POSTGRES_RECOVERY_DSN` secret. Optional Environment variables are
`AQA_TEST_POSTGRES_RECOVERY_EXPECTED_MAJOR` and
`AQA_TEST_POSTGRES_RECOVERY_EXPECTED_LSN`.

The DSN must point to a restored, non-customer-facing target. The workflow does
not write data, expose the DSN in output or claim that a cloud provider
performed PITR, WAL archiving, object restore, KMS verification, replication or
an RTO/RPO drill. Those remain separate provider and DR evidence controls.
