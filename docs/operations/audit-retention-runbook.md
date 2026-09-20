# Audit retention and projection runbook

Status: repository-side operational contract — 2026-09-20

This runbook governs the operational audit projection. It is intentionally
separate from provider immutability: an application query window, a PostgreSQL
row, or a local audit file is not WORM evidence. The final production gate
still requires an operator-owned checkpoint/WORM/KMS execution.

## Invariants

1. A tenant projection always supplies the same `org` and `project` scope to
   both `/api/audit` and `/api/audit/summary`.
2. Scoped reads exclude legacy events without authoritative provenance. They
   must never reinterpret missing tenant columns as globally visible data.
3. `from`, `to` and `kind` are provider-side projection filters. A bounded
   dashboard query must not download an unbounded event payload and filter it
   in the browser.
4. Hash-chain verification is performed before an event range is used as
   evidence. A count or aggregate never proves chain integrity.
5. No retention job deletes a chain prefix unless an independently governed,
   signed checkpoint covers the removed sequence range and the approved
   retention/legal-hold policy allows the operation.
6. Legal hold wins over age. A hold must prevent purge and must be visible in
   the operator record; removing a hold requires a separate authorized action.

## Normal operating procedure

### 1. Inspect the policy

Record, outside Git and without secrets:

- tenant and project scope;
- hot-query window (`from`/`to`) and aggregate dimensions;
- legal-hold identifiers and owner;
- checkpoint reference and digest covering any archive/purge range;
- approved RPO/RTO and the next backup/restore drill deadline.

Do not place customer payloads, credentials, DSNs, bearer tokens or private
keys in the record.

### 2. Verify the live projection

For the same scope, call both endpoints:

```text
GET /api/audit?from=<start>&to=<end>
  x-aqa-org: <org>
  x-aqa-project: <project>

GET /api/audit/summary?from=<start>&to=<end>
  x-aqa-org: <org>
  x-aqa-project: <project>
```

The summary total must equal the number of returned events for a deliberately
bounded test window. For a production dashboard the event list may be capped;
in that case show the summary total and explicitly label the list as a page,
never as the complete audit trail.

Run the tenant-isolation check with a second project in the same organization
and a second organization. Both must return zero events and zero counts for
records owned by the first scope.

### 3. Verify integrity before archive or release use

For filesystem run evidence, run the verifier from the project root and select
the exact run ID. The report command does not accept a directory positional
argument; never assume a directory name selected the target run:

```text
aqa report --run-id <run-id>
```

Confirm that the report output names the intended run before continuing. For a
checkpointed run, verify the checkpoint against the exact event sequence,
count, head hash and run ID. If the checkpoint is signed, verify it with the
approved public trust root. A successful local verification is necessary but
does not prove that the external object is immutable.

### 4. Archive safely

Archive a complete per-run canonical stream plus its checkpoint and a redacted manifest.
Keep the checkpoint reference, SHA-256, sequence range, tenant scope and
capture time together. Preserve the original event order. Do not rewrite
payloads during archival; redaction must happen before the canonical digest is
created.

The current checkpoint verifier requires one run ID, `first_seq: 0` and a
contiguous sequence. Arbitrary tenant/time slices and suffixes after a deleted
prefix are therefore not valid purge units. Keep the full canonical stream, or
do not proceed until a future boundary-aware signed-range verifier exists.

If the archive store cannot prove the requested retention mode, encryption
metadata and read-back digest, stop and classify the operation as
`evidence_incomplete` rather than continuing with purge.

### 5. Purge only after reconciliation

Before a destructive operation, independently check:

- the checkpoint is present, independently governed, signed, and verifies with
  the approved trust root and exact key ID;
- the archive read-back digest matches;
- no legal hold overlaps the range;
- the range is outside the approved hot window;
- the tenant filter is explicit and not inferred from a client-provided key;
- a restore/recovery observation exists for the current backup generation.

If any check fails, do not delete. Record the reason and open an incident or
policy exception. The current repository cannot verify a shortened suffix after
deleting a prefix, so it must classify such a destructive request as
`evidence_incomplete` and retain the full chain. After any supported purge in
the future, query the same scope and a fresh database session, verify the
boundary-aware chain, and record counts/digests. A purge count alone is not
evidence.

## Failure handling

| Symptom | Action |
| --- | --- |
| Summary and list totals disagree | Stop release; compare exact scope/window/kind and inspect provider query logs without exposing payloads. |
| Scoped query returns a legacy row | Treat as an isolation defect; block the projection and migrate only through an explicit, reviewed namespace. |
| Chain verification fails | Freeze archive/purge and preserve the original evidence; do not “repair” hashes in place. |
| Checkpoint missing or mismatched | Keep the range; request a new independently signed checkpoint or restore from the last valid boundary. |
| Legal hold overlaps a purge | Abort the whole operation and retain the hold/audit record. |
| Provider retention/encryption read-back differs | Fail closed and escalate to the provider/deployment owner. |
| Restore drill misses RPO/RTO | Keep production release blocked until the approved objective is re-established and evidenced. |

## Evidence record

The redacted operator record should contain only references and measurements:

```json
{
  "schema_version": "1",
  "operation": "audit_retention_reconciliation",
  "scope": { "org": "example-org", "project": "example-project" },
  "window": { "from": "2026-01-01T00:00:00Z", "to": "2026-02-01T00:00:00Z" },
  "summary_total": 0,
  "listed_total": 0,
  "checkpoint_ref": "external-reference-only",
  "checkpoint_sha256": "64-lowercase-hex-digest",
  "legal_hold_checked": true,
  "provider_retention_readback": "deferred-final-gate",
  "observed_at": "2026-09-20T00:00:00Z"
}
```

The example uses placeholders. Never replace them with real credentials,
customer data or trust-root material in Git.

## Boundary and completion status

The repository now provides tenant-safe event listing, SQL-side aggregation,
admin journey coverage and local chain verification. This runbook closes the
repository-side operational contract. It does not claim completion of S3
Object Lock, KMS/Vault rotation, PostgreSQL PITR, cross-region restore or
independent security/compliance assurance; those remain the deferred final
promotion gates in the roadmap audit.
