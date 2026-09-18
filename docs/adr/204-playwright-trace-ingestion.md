# ADR-204: Safe Playwright trace ingestion

## Status

Accepted — 2026-09-18

## Context

The roadmap requires `aqa ingest playwright ./trace.zip`, but a Playwright
trace is a ZIP archive that may contain credentials, URLs, request headers,
bodies and screenshots. Treating it as ordinary text would either fail to
extract useful evidence or risk persisting sensitive data.

## Decision

`@aqa/ingest` accepts a bounded Playwright trace ZIP and reads only the
`trace.trace` JSONL member. The parser accepts stored and raw-deflate local
entries, rejects encrypted/traversal entries, enforces the existing 10 MiB
input/member limits, and emits action-level records containing only the API
name, bounded call ID, duration and bounded error message. No URL, header,
payload, screenshot or arbitrary trace event is persisted.

The CLI wires this through the same redaction-aware artifact store as the
other ingestion formats. Parsing a trace is evidence ingestion, not proof that
the original browser journey can be replayed; replay remains a separate
complete-journey check.

## Consequences

- Playwright CI traces can enter the common evidence contract without adding a
  new persistence path.
- The implementation remains Node 22 and Bun compatible without a native ZIP
  dependency.
- Trace screenshots, network payloads and browser storage are intentionally
  unavailable to downstream clustering; callers needing them must publish a
  separately governed artifact with explicit redaction policy.
