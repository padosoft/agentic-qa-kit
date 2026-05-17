# Threat model — STRIDE applied to AQA

> Canonical threat model for `agentic-qa-kit`. Apply STRIDE to every trust
> boundary, list specific threats, point to the current mitigation in code.
> If a threat is unmitigated, say so explicitly — that's the input to the
> backlog, not a secret.

## Trust boundaries

```
+----------+         +-----------+         +-----------+
|  user    | <-----> |  admin    | <-----> |  server   |
| (human)  |  HTTPS  |  SPA (UI) |  HTTPS  | @aqa/...  |
+----------+         +-----------+         +-----+-----+
                                                  |
                              +------------------+----------------+
                              |                  |                |
                          +---v----+         +---v---+        +---v---+
                          | runner |         | store |        |  LLM  |
                          | (pool) |         |  pg / |        | vendor|
                          +---+----+         |  s3   |        +-------+
                              |              +-------+
                              | sandboxed
                          +---v----+
                          |  SUT   |  ← actual target under QA
                          +--------+
```

Boundaries (anywhere a security decision must be enforced):

1. **user ↔ admin** — session auth, CSRF, XSS.
2. **admin ↔ server** — OIDC bearer, RBAC.
3. **runner ↔ server** — fleet credential (signed JWT or mTLS), rate limits.
4. **server ↔ store** — least-privilege DB role, prepared statements.
5. **runner ↔ SUT** — sandbox boundary (egress allowlist, resource caps).
6. **runner ↔ LLM vendor** — outbound TLS, key rotation, prompt-injection
   defenses on tool-call replies.
7. **server ↔ audit store** — append-only mode, hash-chain integrity.

## STRIDE catalog

### Spoofing

| ID | Threat | Severity | Mitigation | Status |
|---|---|---|---|---|
| S-01 | Runner impersonation (rogue worker claims fleet credential) | High | Per-runner mTLS or signed JWT issued by `@aqa/auth`; `@aqa/server` validates issuer before enqueue. | Mitigated |
| S-02 | User session hijack via cookie theft | High | `Secure` + `HttpOnly` + `SameSite=Lax` enforced as Risk invariant; pack-security asserts it. | Mitigated |
| S-03 | Pack-author spoofing (malicious pack pretending to be `@aqa/...`) | Critical | Pack signing (cosign-compatible); `@aqa/pack-scanner` refuses unsigned ≥1.0 packs. | Mitigated |
| S-04 | LLM vendor MITM (response forgery) | Medium | TLS pinning at adapter layer (`@aqa/llm-adapters`); content-hash deterministic replay for fixture mode. | Partial — pinning per-adapter, not enforced. |

### Tampering

| ID | Threat | Severity | Mitigation | Status |
|---|---|---|---|---|
| T-01 | Audit log tamper | Critical | Hash-chained `events.jsonl` (`sha256(prev_hash ‖ canonical(rest))`); `aqa-audit-verify` re-walks the chain. | Mitigated |
| T-02 | Finding tamper post-emission | High | Findings written to append-only store; hash chain references finding events. | Mitigated |
| T-03 | Pack manifest swap after signing | Critical | Signature covers manifest hash; load-time verification rejects mismatch. | Mitigated |
| T-04 | DB write bypass (runner writes findings directly) | High | Runner cannot write to store; goes through server API gated by RBAC. | Mitigated |
| T-05 | Replay artifact tamper (`repro.sh`) | Medium | Artifacts referenced by finding; content hash recorded for L3 floor. | Mitigated for L3, advisory for L1/L2. |

### Repudiation

| ID | Threat | Severity | Mitigation | Status |
|---|---|---|---|---|
| R-01 | Operator claims they never ran a pack | High | Every `aqa run` emits `run.start`/`run.end` events with operator identity to the hash-chained log. | Mitigated |
| R-02 | LLM vendor claims they never produced a finding | Medium | Adapter records request/response hashes; fixture mode reproduces deterministically. | Mitigated |
| R-03 | Admin claims they never approved a scenario | High | `@aqa/generator` `ReviewQueue` emits `scenario.approved` event with reviewer identity. | Mitigated |

### Information disclosure

| ID | Threat | Severity | Mitigation | Status |
|---|---|---|---|---|
| I-01 | Finding contents leak (e.g. secrets in summary) | High | Pack contract requires probes to redact known secret formats; finding text passes through allowlist. | Partial — allowlist per pack, not centralised. |
| I-02 | Audit log discloses target endpoints to readers | Medium | Audit reader role gated by `@aqa/auth` `audit:read`. | Mitigated |
| I-03 | Cross-tenant findings visible | Critical | Tenant ID in JWT, server filters all reads by tenant. | Mitigated |
| I-04 | LLM prompt leaks proprietary code via vendor logging | High | On-prem LLM adapter option (`@aqa/llm-adapters` `ScaffoldAdapter` for vLLM/Ollama). | Mitigated for self-hosted; vendor-dependent otherwise. |

### Denial of service

| ID | Threat | Severity | Mitigation | Status |
|---|---|---|---|---|
| D-01 | Runaway LLM cost (intentional or accidental) | Critical | `@aqa/cost` hard cap; server refuses to start with budget=0; per-tenant USD limit enforced at request time. | Mitigated |
| D-02 | Runner pool overwhelmed | Medium | `RunnerQueue` FIFO with visibility leases; backpressure via 429. | Mitigated |
| D-03 | SUT DoS by misconfigured probe | Medium | Per-scenario probe rate documented in pack manifest; profile `release-gate` enforces conservative defaults. | Advisory — enforcement is per-pack. |
| D-04 | Adversarial pack publishes infinite-loop probe | High | Container sandbox CPU/memory limits via cgroups; wallclock cap per probe. | Mitigated via `@aqa/sandbox` (process default; container default with `selectSandbox`). |

### Elevation of privilege

| ID | Threat | Severity | Mitigation | Status |
|---|---|---|---|---|
| E-01 | Runner role escalates to admin (lateral move) | Critical | RBAC permissions stored alongside JWT issuer; `allows(user, action, resource)` is the single gate. | Mitigated |
| E-02 | Pack code escapes sandbox (container escape) | Critical | Read-only rootfs, non-root user, no capabilities by default, network namespace. | Mitigated; periodic pen-test scope (see `docs/compliance/pen-test-scope.md`). |
| E-03 | Tool-call injection via LLM response | High | Tool-call confirmation invariant (Risk `r-agentic-002`); pack-llm-agent asserts no auto-confirm of destructive actions. | Mitigated |
| E-04 | Prompt injection from poisoned tool output | High | Adapter wraps tool results in `<<system-untrusted>>` framing; pack-llm-agent ships scenarios exercising this. | Mitigated; adversarial coverage grows over time. |

## Agentic-specific threats (cross-cutting)

These threats don't fit cleanly into one STRIDE bucket because the agent is
both a *user* of the system (it consumes scenarios) and a *target* (its tool
calls execute side effects).

- **A-01 — Tool-result poisoning.** A malicious upstream returns content
  embedding instructions the LLM might follow. Defense: scenarios in
  `pack-llm-agent` test that the agent does NOT comply with embedded
  instructions in tool output. Tagged `owasp-agentic:a01`.
- **A-02 — Confirmation bypass.** The agent invokes a destructive tool
  without surfacing it to the user. Defense: invariant assertion on
  tool-call wrappers; pack-llm-agent ships scenarios for delete-without-
  confirm. Tagged `owasp-agentic:a02`.
- **A-03 — Pack supply chain.** A signed pack contains a probe that
  exfiltrates SUT data to a third-party. Defense: `@aqa/pack-scanner`
  flags always-on-shell packs; sandbox NetworkPolicy denies egress
  outside operator-provided CIDRs. See `deploy/helm/templates/networkpolicy.yaml`.
- **A-04 — Cost-based DoS.** An agent enters a loop that exhausts the
  LLM budget. Defense: `@aqa/cost` per-tenant cap + per-request cost
  estimate gating. See `D-01`.

## Pen-test cadence

See [`docs/compliance/pen-test-scope.md`](../compliance/pen-test-scope.md)
for in-scope surfaces, out-of-scope items, cadence, and reporting flow.
Pen-test findings are filed as `@aqa/schemas` `Finding` records and flow
through the same hash-chained audit pipeline as internal findings.

## How this document is maintained

- **Add a row** when a new feature opens a new attack surface.
- **Flip status to Mitigated** in the same PR that ships the defense.
- **Never silently downgrade** severity — if reality differs from this
  table, file an issue and link it.
