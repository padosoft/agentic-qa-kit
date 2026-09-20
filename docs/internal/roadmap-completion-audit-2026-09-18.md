# Roadmap completion audit — 2026-09-18

This is the authoritative close-out audit for the enterprise blueprint in
`docs/internal/implementation-plan.md`. It distinguishes repository evidence
from provider/deployment evidence. A green unit test, a fixture, or a prepared
workflow is not counted as a live provider proof until the protected workflow
has actually run with an operator-owned environment.

## Status vocabulary

| Status | Meaning |
| --- | --- |
| `verified` | Implemented and covered by repository tests plus the hosted technical matrix, or by a named complete journey. |
| `evidence-ready` | The code and protected workflow exist, but an operator execution is still required. |
| `external-required` | Cannot be honestly completed from this repository alone: it needs a provider account, production deployment, audit or independent human action. |
| `deferred-final-gate` | Intentionally parked until the project is promoted from side project to production/customer use; it is not a blocker for local development or side-project validation. |
| `partial` | A meaningful contract exists, but one or more required capabilities are still missing. |

## Milestone audit

| Blueprint milestone | Current assessment | Evidence / remaining gap |
| --- | --- | --- |
| v0.1 Foundations | `verified` | Versioned schemas, CLI, packs, adapters, sandbox boundaries, signed evidence and hash-chained audit are covered by packages, ADRs and CI. |
| v0.2 Determinism and cost | `verified` | Replay levels, canonical outcomes, budget/cost enforcement, flake and provenance controls are implemented; LLM nondeterminism is explicitly not treated as deterministic replay. |
| v0.3 Enterprise table-stakes | `verified` for repository scope; `deferred-final-gate` for deployment | PostgreSQL, S3, OIDC/RBAC, pack trust, on-prem LLM boundaries, Helm, air-gap and redaction are implemented. Actual KMS/IAM/Vault, WORM and external IdP execution are intentionally deferred to final promotion. |
| v0.4 Admin UI | `verified` | API/UI journeys are exercised by Playwright and the technical CI matrix. |
| v0.5 Multi-team/cloud-ready | `verified` for control-plane contracts | Tenant scope, runner fleet, queue priority/DLQ/fencing, findings lifecycle, webhooks, DR tooling and observability are implemented and tested. HA, ingress, load and SLO measurements remain deployment evidence. |
| v0.6 Methodology rigor | `partial` | STRIDE/FMEA/OWASP, risk coverage, oracle safety/calibration, bounded mutation evidence, reviewed mutation-to-regression execution evidence, explainable same-risk semantic clustering, reviewed-pair threshold calibration and deterministic holdout evaluation exist. Protected mutation execution at scale, independent methodology validation and external governance remain open. |
| v1.0 Production-ready enterprise | `deferred-final-gate` | Penetration test, SOC2/ISO attestation, legal SLA, reference customers and independent security/compliance validation are intentionally parked until product promotion; they remain mandatory before enterprise/customer production claims. |
| v2.1 Commerce Assurance | `verified` for contracts; `deferred-final-gate` for providers | Checkout, money, inventory, refunds, promotions, stored value, subscriptions, dunning, disputes, loyalty, fulfillment/RMA, Stripe and gift-card boundaries exist. Live provider settlement, payout, tax, shipping, WMS/carrier and issuer execution are intentionally deferred to the final promotion gate. |
| v2.2 Stateful agentic QA | `partial` with deferred production gate | Capability preflight, bounded state graph validation, actor-bound runtime journey compilation/execution, CLI/worker lifecycle integration, temporal observers, safe journey-to-trace correlation, evidence boundaries, bounded OTLP trace federation and repository-side mutation-to-regression evidence exist. Protected producer execution and production-grade trace/provenance execution are deferred until real deployment promotion; local contracts remain in scope now. |

## Explicit project-stage decision — 2026-09-19

The owner is currently validating AQA as a side project against other side
projects and cannot provide provider credentials, signed production trust roots,
penetration-test reports or compliance attestations. This is an intentional
stage decision, not an implementation failure.

The following two gates are parked at the **end** of the roadmap:

1. **Provider/deployment evidence:** protected Stripe/gift-card, S3/KMS/WORM,
   PostgreSQL PITR/RTO/RPO, IdP/mTLS, mutation-producer and signed production
   evidence workflows.
2. **Independent assurance:** penetration test, SOC2/ISO, legal SLA, reference
   customers and independent security/compliance sign-off.

Everything that can be implemented, simulated with safe local fixtures, tested
with complete journeys, or validated in repository CI remains active roadmap
work. These deferred gates must not be reported as completed, but they must not
block side-project development or local product validation.

## Protected provider evidence now available

## External readiness snapshot — 2026-09-19

The repository-side checks were repeated against the live GitHub repository
before this audit update. `main` is now protected through the GitHub API with
the technical CI matrix, one required pull-request approval, stale-review
dismissal, linear history, conversation resolution, admin enforcement and no
force-push/delete exceptions. The six provider/evidence Environments are also
present with a required reviewer and protected-branch deployment policy:
`commerce-provider-evidence`, `production-evidence`,
`production-database-evidence`, `production-identity-evidence`,
`methodology-mutation-evidence` and `production-artifact-evidence`.

The repository secret listing still contains no provider credentials (only the
Copilot integration entry). Therefore no provider workflow was started: the
governance controls now exist, but there is still no operator-owned protected
resource to exercise, and starting a workflow without it would create a false
negative rather than evidence of readiness.

This snapshot is metadata-only and contains no secret values.

These workflows are intentionally manual and fail closed when the required
Environment configuration is absent:

- `artifact-provider-evidence.yml` — Object Lock and encryption metadata;
- `postgres-provider-evidence.yml` — isolated dump/restore compatibility;
- `postgres-recovery-provider-evidence.yml` — read-only recovery-target posture;
- `oidc-provider-evidence.yml` — authorization-code, PKCE, JWKS and UserInfo;
- `mtls-runner-rotation-evidence.yml` — mTLS plus old/new runner token behavior;
- `gift-card-provider-evidence.yml` — read-only issuer reconciliation;
- `stripe-provider-evidence.yml` — read-only Stripe test-mode PaymentIntent;
- `mutation-evidence-gate.yml` — protected reusable gate for producer-uploaded
  mutation, reviewed coverage and optional observed regression artifacts.

The workflows are not evidence merely because they are present in Git. The
operator must run them in their protected environments and retain the redacted
results. The production evidence release gate then binds signed observations,
restore-drill records and trust roots without accepting secrets in Git.

## Remaining work, ordered by dependency

1. Close the remaining repository-side gaps still testable locally. Durable
   audit projections, retention/runbook controls and local multi-runner/trace
   provenance are now verified; the active gaps are bounded load/chaos
   execution evidence, methodology mutation-to-regression scale/holdout
   governance, and complete ecommerce failure-injection/idempotency journeys.
2. Validate the complete side-project journey against local/example targets and
   keep all limitations explicit in evidence and reports.
3. **Deferred final gate:** configure and execute protected provider workflows
   with disposable or approved test resources; record run URLs, timestamps,
   provider references and redacted observations outside Git.
4. **Deferred final gate:** execute KMS/Vault rotation and IAM-denial drills,
   PostgreSQL PITR/RTO/RPO, IdP rollover, commerce provider settlement/tax/
   shipping/fulfillment and protected mutation-scale evidence.
5. **Deferred final gate:** complete external penetration testing, compliance
   attestations, legal SLA, reference customers and independent sign-off.

## Release decision

The repository is not allowed to claim `production-ready enterprise` solely
from this audit. The code/CI baseline is substantially complete for side-project
validation, while the explicitly deferred gates remain release conditions for
future production/customer promotion. When those gates become feasible, update
this document with immutable evidence references and change only the
corresponding rows to `verified`.
