# AQA Kit — Deep Analysis & Enterprise Blueprint (self-hosted)

> **Audience note (English):** this is a **maintainer-internal** document written in Italian by the project lead. It contains the deep design rationale and the full execution plan for `agentic-qa-kit`. English-speaking contributors and AI agents should read the `README.md`, `AGENTS.md`, `docs/RULES.md`, `docs/getting-started.md`, `docs/ecosystem-explained.md`, and `docs/adr/` for contributor-facing material. A translated English version of this plan will be split into ADRs and contributor docs over time.
>
> **Data:** 2026-05-16 (aggiornato 2026-05-17 con relocation in `docs/internal/`)
> **Autore richiesta:** Lorenzo Padovani (project lead)
> **Scope:** deep analysis critica della proposta originale, identificazione falle/gap, roadmap di enterprise readiness per deploy self-hosted on-prem/private cloud, con focus aggressivo su (a) determinismo & affidabilità e (b) scalabilità & operations. Sicurezza/compliance trattate come table-stakes enterprise non opzionali.

---

## Context

Hai prodotto una proposta strutturata per un toolkit open source (`agentic-qa-kit`) che trasforma agenti di coding (Claude/Codex/Gemini/Copilot) in QA engineer guidati da risk-map, invarianti, probe, oracle e replay. Il design è interessante e tecnicamente plausibile, ma l'analisi originale ha un bias da prodotto community-first che lascia scoperti diversi pilastri necessari per essere installato in azienda dentro un perimetro enterprise (banca, telco, manifatturiero, healthcare, PA, ecommerce regulated).

Questo plan ha tre obiettivi:

1. **Identificare le falle critiche** che impediscono l'adozione enterprise — alcune sono blocker assoluti (es. determinismo del replay quando l'attore è un LLM), altre sono debolezze metodologiche (es. come si misura davvero la "copertura" di un rischio).
2. **Proporre un blueprint di riferimento self-hosted** con architettura, threat model, capability matrix, SLO, observability nativa, governance dei costi e governance del supply chain dei pack.
3. **Riscrivere la roadmap** mettendo in testa quello che senza, l'enterprise non firma: sandboxing reale, observability di prima classe, schemi versionati, audit immutabile, BYOK LLM, cost guardrail. Le feature "AI generation con un bottone" e "marketplace community" vanno indietro, non avanti.

Il plan **non riscrive** la proposta originale: la complementa con rigore enterprise.

---

## Indice

1. [Sintesi esecutiva — le 12 falle critiche](#1-sintesi-esecutiva-le-12-falle-critiche)
2. [Ambiguità architetturale di fondo: agent-as-actor vs orchestrator-as-actor](#2-ambiguità-architetturale-di-fondo)
3. [Deep dive 1 — Determinismo & affidabilità](#3-deep-dive-1-determinismo-e-affidabilita)
4. [Deep dive 2 — Scalabilità & operations](#4-deep-dive-2-scalabilita-e-operations)
5. [Sicurezza & supply chain (enterprise table-stakes)](#5-sicurezza-supply-chain-enterprise-table-stakes)
6. [Compliance, governance, audit](#6-compliance-governance-audit)
7. [Gap di architettura non-funzionali](#7-gap-di-architettura-non-funzionali)
8. [Gap di metodologia QA / dominio testing](#8-gap-di-metodologia-qa-dominio-testing)
9. [Capability matrix agent target (Claude/Codex/Gemini/Copilot)](#9-capability-matrix-agent-target)
10. [Reference architecture — Enterprise self-hosted](#10-reference-architecture-enterprise-self-hosted)
11. [Threat model sintetico (STRIDE applicato ad AQA)](#11-threat-model-sintetico)
12. [SLO/SLI proposti per la piattaforma](#12-slosli-proposti-per-la-piattaforma)
13. [Compliance matrix](#13-compliance-matrix)
14. [ADR (Architecture Decision Records) da scrivere prima del primo commit](#14-adr-architecture-decision-records-da-scrivere)
15. [Roadmap enterprise rivista](#15-roadmap-enterprise-rivista)
16. [Metriche di successo (prodotto e adozione)](#16-metriche-di-successo)
17. [Anti-patterns da evitare esplicitamente](#17-anti-patterns-da-evitare-esplicitamente)
18. [Verifica end-to-end del plan](#18-verifica-end-to-end-del-plan)

---

## 1. Sintesi esecutiva — le 12 falle critiche

| # | Falla | Severità | Impatto enterprise | Categoria |
|---|---|---|---|---|
| F01 | Ambiguità "chi esegue lo scenario": agente (Claude/Codex) o runner kit? Cambia tutto: sandbox, costi, replay, determinismo. | **Blocker** | Non si può fare security review né capacity planning senza saperlo. | Architettura |
| F02 | Determinismo del replay assunto, mai garantito quando l'attore è un LLM. "reproduced 3/3" è ambiguo (bug del SUT vs discovery dell'agente). | **Blocker** | False positive industriali; auditor lo segnano come "non riproducibile". | Determinismo |
| F03 | Nessuna cost governance LLM (token/dollari per scenario/profile/project/org/runner). Solo `budget_minutes`. | **Blocker** | Un singolo `aqa run --profile release` può bruciare migliaia di $. | Operations |
| F04 | Sandbox agentica = flag booleano (`destructive: false`). Nessun isolation reale (container, netns, fs caps). | **Blocker** | Security review fallita al primo round. | Sicurezza |
| F05 | Supply chain pack: la community può pubblicare pack che sono **prompt arbitrari eseguiti come QA engineer** contro repo proprietario. Nessun signing, nessuno scanning, nessuna review obbligatoria. | **Blocker** | Prompt injection persistente, exfiltration via tool calls. | Supply chain |
| F06 | Observability "future integration". Senza OTel/trace/metric correlati dal giorno 1, debug e SLO sono impossibili. | **Critica** | Incidenti non triagabili in produzione. | Operations |
| F07 | SQLite come state primario. Concorrenza/replicazione assenti. Per >1 runner o cloud control plane è inadatto. | **Critica** | Corruzione stato, lock contention. | Operations |
| F08 | Bun-only. Enterprise tipico ha allowlist di runtime; Bun raramente passa security review prima di Node. Nessun piano fallback. | **Critica** | Adozione bloccata o ritardata di trimestri. | Adozione |
| F09 | Isolation tra scenari concorrenti contro stesso DB/SUT. Reset comando esiste ma scenari paralleli si contaminano → false positive. | **Critica** | Findings rumorosi, fiducia QA crolla. | Determinismo |
| F10 | Oracle methodology poco rigorosa. LLM-as-judge usato come jolly senza calibrazione né inter-rater reliability né fallback chain. | **Critica** | "Confidence 0.86" è arbitrario. | Determinismo |
| F11 | Findings dedup / root-cause clustering assenti. Lo stesso bug genererà N findings con N agenti. La pagina Kanban diventa inusabile. | **Alta** | Triage hour esplode → progetto muore. | Metodologia |
| F12 | Audit log immutabile assente. `events.jsonl` è append-only ma non hash-chained né WORM. Compliance SOC2/ISO non passa. | **Alta** | Audit interno fallito. | Compliance |

Le altre falle (M1–M6, A1–A7, Sec1–Sec7, C1–C4) sono dettagliate nelle sezioni successive.

---

## 2. Ambiguità architetturale di fondo

> **Questa è la falla #1. Va risolta prima di scrivere una riga di codice.**

Nel documento originale convivono due modelli di esecuzione che hanno requisiti, costi e profili di rischio completamente diversi:

### Modello A — Agent-as-actor (l'agente di coding esegue)

L'utente apre Claude/Codex/Gemini/Copilot nel suo IDE/CLI. AQA Kit ha installato `SKILL.md`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`. L'agente di coding legge la risk-map, decide cosa fare, chiama tool (shell, http, read_file), genera scenari, esegue probe, valuta oracle, crea finding.

**Caratteristiche:**
- Sandbox = sandbox dell'agente host (Claude Code sandbox, Codex sandbox/approval, ecc.). AQA Kit **non controlla** cosa l'agente fa davvero.
- Costo LLM = pagato dall'utente sul suo account vendor (Anthropic API, OpenAI API, Google, GitHub Copilot subscription).
- Replay = quasi impossibile a livello agente. Replay deterministico solo se l'agente produce **artefatti deterministici** (curl, playwright trace, SQL).
- Determinismo = nessuno. Stessa risk-map, stesso repo, due run = due output diversi.
- Audit = limitato a ciò che l'agente decide di scrivere su `events.jsonl`.

### Modello B — Orchestrator-as-actor (il runner kit esegue)

`bunx aqa run --profile security` parte. Il runner del kit legge gli scenari YAML, esegue probe **deterministicamente** (HTTP, shell, Playwright, SQL), valuta oracle, scrive finding. L'LLM viene chiamato **solo** per: (a) generazione di nuovi scenari quando richiesto, (b) LLM-as-judge per oracle semantici, (c) bug minimization.

**Caratteristiche:**
- Sandbox = controllata dal kit (container, netns, fs caps). Possibile.
- Costo LLM = pagato dall'org tramite chiavi configurate nel kit. Controllabile, attribuibile, budget-able.
- Replay = deterministico per la parte non-LLM. Per gli scenari LLM-generated, serve fixture/seed.
- Determinismo = alto per probe, semi per oracle, basso per generazione.
- Audit = completo, il kit vede tutto.

### Conseguenza per enterprise

Enterprise vuole **Modello B come default in CI/CD/release-gate**, con Modello A disponibile in modalità "dev exploratory" per il lavoro quotidiano dello sviluppatore sul suo laptop. Non sono incompatibili, ma vanno **dichiarati esplicitamente** in ogni feature, ogni comando CLI, ogni schema.

### Raccomandazione (ADR-001)

Adottare **dual-mode esplicito** con questa semantica:

```yaml
# .aqa/profiles.yaml
profiles:
  smoke:
    execution_mode: orchestrator      # B
    llm_usage: [scenario_generation, semantic_oracle]
    llm_budget_usd: 5
  exploratory:
    execution_mode: agent             # A — dev locale
    llm_usage: [agent_driven]
    llm_budget_usd: null              # pagato dall'utente
  release-gate:
    execution_mode: orchestrator      # B obbligatorio
    llm_usage: [scenario_generation]
    llm_budget_usd: 50
    require_deterministic_replay: true
```

Ogni finding deve dichiarare in metadata `execution_mode` per essere triagable correttamente.

---

## 3. Deep dive 1 — Determinismo & affidabilità

### 3.1 Replay: tassonomia mancante

Il documento usa "replay" come fosse una cosa sola. In realtà esistono **tre livelli di replay**, ciascuno con garanzie diverse:

| Livello | Cosa replica | Garanzia | Artefatto |
|---|---|---|---|
| **Bug-level replay** | Riproduce il bug nel SUT (cURL/Playwright/SQL) | Deterministico (se SUT lo è) | `repro.sh`, `repro.playwright.ts` |
| **Scenario-level replay** | Riesegue lo scenario YAML completo | Deterministico se probe e oracle sono deterministici | `scenario.yaml` + `seed.json` |
| **Agent-level replay** | Riesegue l'agente con stesso input | **Non deterministico per design** | `prompt.txt` + `model_version` + `seed` (best-effort) |

**Falla:** lo schema `finding` ha `reproducible: true` e `reproduced_runs: 3` ma non dichiara **quale livello** è stato verificato. Un bug "reproduced 3/3" a livello agent (l'agente lo trova 3 volte su 3) è molto diverso da uno "reproduced 3/3" a livello bug (il SUT lo riproduce 3 volte su 3). Il primo è statistico, il secondo è deterministico.

**Fix obbligatorio:** estendere schema finding:

```json
{
  "id": "AQA-2026-0001",
  "reproducibility": {
    "bug_level": {
      "deterministic": true,
      "attempts": 10,
      "successes": 10,
      "artifact_path": "replay/repro.sh"
    },
    "scenario_level": {
      "deterministic": true,
      "attempts": 5,
      "successes": 5,
      "seed": "0xdeadbeef"
    },
    "agent_level": {
      "deterministic": false,
      "attempts": 5,
      "successes": 3,
      "model_pinned": "claude-opus-4-7@2026-05-01",
      "discovery_rate": 0.6
    }
  },
  "verification_floor": "bug_level"   // minimo livello richiesto per status=verified
}
```

**Regola enterprise:** `release-gate` non accetta `status: verified` senza `bug_level.deterministic: true` con ≥3 successi su ≥3 tentativi.

### 3.2 LLM determinism — quello che davvero si può ottenere

Anche con `temperature=0`, gli LLM moderni non sono deterministici per:
- Variazione di tokenizer/quantization tra deploy del provider
- KV cache batching dipendente dalla concorrenza sul server
- Floating-point non-associativity su GPU
- Aggiornamenti silenziosi del modello (anche con alias "stable")

**Raccomandazione:**

1. **Model pinning obbligatorio** in ogni run: salvare `provider`, `model_id`, `model_version_hash`, `api_version`, `region` nel `config_snapshot`.
2. **Prompt hashing** SHA-256 di prompt + system + tool definitions + tool results inseriti nel contesto. Serve per detect drift.
3. **Replay LLM "best-effort"** marcato come tale. Non promettere riproducibilità che non puoi mantenere.
4. **Fixture-mode LLM** per regression: catturare richiesta/risposta una volta, riprodurre in CI senza chiamare il vendor. Critico per scenari ripetuti su PR.
5. **On-prem LLM option** (vLLM, llama.cpp, Bedrock private endpoint) per enterprise con dati sensibili **e** requisiti di determinismo più stringenti.

### 3.3 Statistical foundations: confidence e calibration

Lo schema finding ha `"confidence": 0.86`. Su quale base? Non è definito. **Senza calibrazione, è arbitrario**.

**Specifica mancante:**

- Definire **da dove** viene il confidence score (somma pesata di: oracle agreement, agent self-reported, judge ensemble, replay success rate, historical false-positive rate per scenario/risk).
- Calibrare: quando il sistema dice 0.8, la verifica umana deve confermare il bug ~80% delle volte. Misurato con **reliability diagrams** su dataset di gold-standard findings (creato dal team QA durante v0.x).
- Esporre `confidence_components` nel finding per debug/audit:

```json
"confidence_components": {
  "oracle_agreement": 1.0,
  "agent_self_reported": 0.9,
  "judge_ensemble_score": 0.85,
  "replay_success_rate": 1.0,
  "historical_fp_rate_for_risk": 0.12,
  "aggregate_formula": "weighted_geometric_mean_v1",
  "calibration_curve_id": "cal_2026_q2"
}
```

### 3.4 Flaky scenarios — taxonomy e quarantine

Il documento menziona "flaky scenarios" in metriche ma non ha:
- Definizione operativa di "flaky"
- Detection algorithm
- Quarantine policy
- Flake budget per profilo

**Specifica:**

```yaml
flakiness:
  detection:
    window_runs: 30
    flaky_if_pass_rate_in: [0.05, 0.95]   # non sempre passa né sempre fallisce
    min_runs_required: 10
  quarantine:
    auto_quarantine: true
    on: pass_rate_in_window < 0.90
    expires_after_passes: 20
    exclude_from_release_gate: true
    notify_owner: true
  budget:
    smoke_profile:
      max_flaky_scenarios: 2
      block_run_if_exceeded: false
    release_gate_profile:
      max_flaky_scenarios: 0
      block_run_if_exceeded: true
  categories:
    - environmental    # rete, DNS, container slow start
    - timing           # race condition nel test stesso
    - ordering         # dipendenza da scenario precedente
    - infrastructure   # runner OOM, disk full
    - agent_side       # LLM ha scelto path diverso
```

**Fix obbligatorio:** integrare `flake_history` nel finding schema e nel risk-coverage report.

### 3.5 Isolation tra scenari concorrenti

Il `reset_test_env` nel `project.yaml` è single-shot. Se 10 scenari girano in parallelo contro lo stesso DB, lo scenario A può vedere effetti dello scenario B → false positive di cross-contamination (che AQA chiama "cross-tenant leak" sbagliando).

**Strategie da supportare nativamente:**

| Strategia | Costo | Affidabilità | Use case |
|---|---|---|---|
| Serial execution | Lento | Massima | Scenari distruttivi, security pass |
| DB transaction-per-scenario (BEGIN/ROLLBACK) | Basso | Alta (no async) | Backend test su DB transazionale |
| Schema-per-scenario | Medio | Alta | Postgres multi-schema |
| Container ephemeral-per-scenario | Alto | Massima | Heavy isolation, security |
| Cluster ephemeral-per-run | Molto alto | Massima | Release gate full |

Il kit deve esporre nella `profiles.yaml`:

```yaml
profiles:
  release-gate:
    isolation:
      strategy: container_per_scenario
      base_image: "aqa/sut:latest"
      teardown: always
      parallelism: 8
      max_concurrent_per_db: 1
```

E un comando `aqa env up/down` che orchestri lifecycle degli ambienti effimeri (compose, kind, k3d, dev container).

### 3.6 Oracle robustness — la fallback chain

Il documento elenca 14 tipi di oracle ma non:
- Definisce priorità / fallback
- Affronta i bias dei judge LLM (position, length, sycophancy, self-preference)
- Specifica come combinare oracle multipli sullo stesso check

**Specifica oracle chain (ADR-002):**

```yaml
oracle_chain:
  policy: deterministic_first
  rules:
    - if: deterministic_oracle_available
      use: deterministic_oracle
      confidence_floor: 0.95
    - if: semi_deterministic_available
      use: semi_deterministic + assertion
      confidence_floor: 0.80
    - if: only_llm_judge_available
      use: ensemble_of_3_judges
      require_agreement: 2_of_3
      max_confidence: 0.70
      escalate_to_human: confidence < 0.85
```

LLM judges devono essere usati:
- Mai da soli per release-gate decisions
- Sempre ensemble (3 modelli diversi, possibilmente di vendor diversi)
- Calibrati contro gold standard del team
- Con prompt template versionato e testato

### 3.7 Tool-call budget, recursion guards, dead-man timer

`budget_minutes` è la sola guardia. Insufficiente: un agente in loop può fare 10k tool call in 5 minuti.

**Guardrail aggiuntivi:**

```yaml
agent_guardrails:
  max_tool_calls_per_run: 500
  max_tool_calls_per_minute: 60
  max_consecutive_same_tool: 10
  max_depth_subagent_spawn: 3
  max_tokens_total: 2_000_000
  max_tokens_per_call: 100_000
  dead_man_timer_seconds: 600    # nessun output utile → kill
  oom_kill_mb: 4096
  egress_allowlist: [localhost, "*.internal"]
  egress_denylist: ["*.openai.com"]   # per profile orchestrator senza LLM esterno
  cost_kill_switch_usd: 25
```

Ogni violazione = run failed + finding `agent.violated_guardrail` di severità P1.

### 3.8 Determinismo della generazione (AI-generated artifacts)

Il "wizard Generate with AI" produce risk-map, scenari, prompt. Senza governance, dopo 6 mesi nessuno sa quale prompt ha generato cosa.

**Specifica provenance (estensione di ciò che è già nel doc, ma con regole più rigide):**

```json
{
  "artifact_id": "scenario_api_cross_tenant_v3",
  "generation": {
    "type": "scenario",
    "generator_version": "aqa-generator@1.2.0",
    "provider": "anthropic",
    "model": "claude-opus-4-7@2026-05-01",
    "prompt_template_id": "tpl_scenario_gen_v4",
    "prompt_template_hash": "sha256:abc...",
    "prompt_input_hash": "sha256:def...",
    "temperature": 0,
    "seed": 42,
    "input_sources": [
      {"path": ".aqa/risk-map.yaml", "sha256": "..."},
      {"path": "openapi.yaml", "sha256": "..."}
    ],
    "generated_at": "2026-05-16T12:00:00Z",
    "generated_by_user": "lopadovani@padosoft.com",
    "reviewed_by": null,
    "approved_for_production": false
  },
  "lifecycle_state": "draft"   // draft | reviewed | approved | active | archived
}
```

**Regola:** nessun artefatto AI-generated diventa `active` senza review umana esplicita (firmata) registrata in audit log.

---

## 4. Deep dive 2 — Scalabilità & operations

### 4.1 Cost governance LLM (gap critico)

Il documento ha **zero** budget enforcement sui token/dollari. Per un'enterprise che fa centinaia di run/giorno questo è un blocker assoluto.

**Specifica `cost-governance.yaml`:**

```yaml
cost_governance:
  enabled: true
  pricing_table: ./pricing/2026-q2.yaml   # token→USD per modello/provider/regione
  enforcement: hard                        # hard | soft | warn-only

  budgets:
    org:
      monthly_usd: 5000
      hard_stop: true
    per_project:
      "crm-backend":
        monthly_usd: 1500
        per_run_usd: 50
      default:
        monthly_usd: 500
    per_profile:
      smoke:    {per_run_usd: 2}
      release:  {per_run_usd: 100}
    per_runner:
      "github-actions-*":
        per_day_usd: 200

  attribution:
    by: [project, profile, scenario, risk_area, pack, model]
    export: prometheus + csv

  policies:
    on_budget_50pct: notify
    on_budget_80pct: warn + degrade_to_cheaper_model
    on_budget_100pct: kill_run + alert + open_incident

  byok:
    enabled: true
    vault_backend: hashicorp-vault   # | aws-kms | azure-keyvault | gcp-secret-manager
    key_rotation_days: 90
```

**CLI:**

```
bunx aqa cost report --since 30d --by project,profile
bunx aqa cost forecast --profile release --packs all
bunx aqa cost limits --set project.crm-backend.monthly_usd=2000
```

**Metriche Prometheus obbligatorie:**
- `aqa_llm_tokens_total{provider,model,project,profile,scenario}` (counter)
- `aqa_llm_cost_usd_total{provider,model,project,...}` (counter)
- `aqa_llm_budget_remaining_usd{org,project}` (gauge)
- `aqa_llm_budget_exceeded_total{...}` (counter)

### 4.2 Runner orchestration — job/queue semantics

Il doc ha `POST /v1/runners/:id/jobs/next` ma niente sulla semantica di consegna. Per self-hosted enterprise serve:

| Aspetto | Specifica |
|---|---|
| Delivery semantics | At-least-once con idempotency_key per job |
| Visibility timeout | 5 min, configurabile per profile |
| Retry policy | Exponential backoff, max 3, with jitter |
| Dead letter queue | Job che falliscono 3x → DLQ + alert + manual triage |
| Job priority | 0-9, alto = prima. Release-gate = 9, smoke PR = 5, exploratory = 2 |
| Fairness | Round-robin per project entro priority class (weighted fair queueing) |
| Runner labels | `os=linux`, `arch=amd64`, `has=playwright,docker,gpu`, `vendor=claude`. Job specifica `requires:`. |
| Backpressure | Server respinge job se queue > N; runner respinge job se carico > N |
| Idempotency | Stesso `run_id` ri-pollato non duplica esecuzione |

**Tecnologie consigliate per self-hosted:**
- Queue: PostgreSQL + `pg_listen/notify` per piccolo; Redis Streams o NATS JetStream per medio; Kafka per grande
- Astrarre dietro `interface JobQueue` per swap

### 4.3 Observability — first class day-1, non "future"

**Trace obbligatori (OpenTelemetry):**

```
trace: run_2026_05_16_001
├── span: profile_setup
├── span: scenario_api_cross_tenant
│   ├── span: precondition_setup
│   ├── span: probe_change_project_id
│   │   ├── span: http.request POST /api/login
│   │   ├── span: http.request GET /api/projects/123
│   │   └── span: oracle_evaluation
│   │       ├── span: oracle.http_status
│   │       └── span: oracle.response_not_contains
│   └── span: finding_creation
├── span: agent_session_security_redteamer (se mode=agent)
│   ├── span: llm.call provider=anthropic model=opus
│   │   └── attribute: tokens.input=1234 tokens.output=567 cost_usd=0.045
│   └── span: tool.shell command="curl ..."
└── span: finding_verification
```

**Metric core (Prometheus naming):**

| Metric | Type | Labels |
|---|---|---|
| `aqa_run_duration_seconds` | histogram | project, profile, status |
| `aqa_scenario_duration_seconds` | histogram | project, scenario_id, status |
| `aqa_scenario_outcome_total` | counter | project, scenario_id, outcome=pass\|fail\|flaky\|error |
| `aqa_findings_created_total` | counter | project, severity, area, risk_id |
| `aqa_findings_verified_total` | counter | project, severity, verification_floor |
| `aqa_findings_false_positive_total` | counter | project, severity, risk_id |
| `aqa_llm_calls_total` | counter | provider, model, project, purpose |
| `aqa_llm_tokens_total` | counter | provider, model, project, direction=in\|out |
| `aqa_llm_cost_usd_total` | counter | provider, model, project |
| `aqa_oracle_evaluations_total` | counter | oracle_type, outcome |
| `aqa_replay_attempts_total` | counter | finding_id, level=bug\|scenario\|agent, outcome |
| `aqa_runner_jobs_in_flight` | gauge | runner_id, project |
| `aqa_runner_queue_depth` | gauge | priority |
| `aqa_state_db_size_bytes` | gauge | project |

**Log obbligatori (structured JSON):**
- Sempre: `trace_id`, `span_id`, `run_id`, `org_id`, `project_id`, `user_id`/`runner_id`
- Sampling: 1.0 per error, 0.1 per info, configurabile
- Schema validato (Zod) — no log unstructured

**Distribuzione di artefatti pronti per enterprise:**
- Grafana dashboards (JSON) sotto `integrations/observability/grafana/`
- Prometheus alerting rules (YAML) sotto `integrations/observability/prometheus/`
- OTel Collector config di esempio
- Loki/Tempo helm values di esempio (per enterprise stack moderni)

### 4.4 Storage abstraction — SQLite locale, Postgres cloud, S3 artifact

`bun:sqlite` è ok per dev locale singolo utente, **non** per:
- Più di un runner che scrive in concorrenza
- Backup e replicazione
- Schema migration con downtime zero
- Audit log multi-region

**Specifica (ADR-003):**

```typescript
interface AqaStore {
  runs: RunsRepo;
  findings: FindingsRepo;
  events: EventsRepo;
  artifacts: ArtifactStore;   // BLOB
  config: ConfigRepo;
  audit: AuditRepo;
  migrations: MigrationRunner;
}

// Implementazioni:
// - SqliteStore (dev/local)
// - PostgresStore (self-hosted + cloud)
// - HybridStore (postgres + S3 per artifact)
```

| Concern | SQLite (local) | Postgres (self-hosted) |
|---|---|---|
| Stato run/finding | sqlite file | postgres schema `aqa` |
| Event log | events.jsonl | postgres table + pg_partman per partitioning mensile |
| Artifact (log, screenshot, trace) | filesystem | S3-compatible (MinIO per air-gap) |
| Audit log | hash-chained jsonl | hash-chained postgres table, opzionalmente WORM su S3 Object Lock |
| Schema versioning | sqlx-style migrations | sqlx-style migrations |

**Backup story (CRITICA, mancante nel doc):**

```bash
# Locale
bunx aqa backup --output ./aqa-backup-2026-05-16.tar.zst

# Self-hosted
bunx aqa-server backup --target s3://backup-bucket/aqa/ --encrypt-with kms:key/aqa-backup
bunx aqa-server restore --from s3://backup-bucket/aqa/2026-05-16/ --to-point-in-time "2026-05-16T10:00:00Z"
```

**RPO/RTO target self-hosted:**
- RPO ≤ 15 min (WAL streaming a S3)
- RTO ≤ 1h
- Backup integrity test settimanale automatico

### 4.5 SLO/SLI proposti per la piattaforma

| SLI | SLO | Misurato come |
|---|---|---|
| Run start latency (job submitted → scenario started) | p95 < 30s | trace span `job.scheduled` → `scenario.started` |
| Scenario execution success rate | 99.5% (eccetto findings legittimi) | `outcome != error` |
| API availability (control plane) | 99.9% mensile | uptime probe ogni 30s |
| Replay success rate (bug-level) | ≥ 95% per finding `verified` | replay test orario |
| Finding triage time (P0/P1) | p95 < 4h (con notifica) | finding.created → finding.verified/rejected |
| LLM call success rate | ≥ 98% (escluso budget) | retry logic logged |
| Runner heartbeat freshness | ≥ 99% sotto 60s | heartbeat metric |

Tutti gli SLO devono essere espressi come **error budget** consumabile, dashboard inclusa.

### 4.6 Disaster recovery

Sezione completamente assente nel documento. Per enterprise self-hosted serve:

- **Backup**: full daily + WAL continuo, retention 30 giorni, off-site copy
- **Restore drill**: testato trimestralmente, documentato in runbook
- **Multi-region (opzionale enterprise tier)**: active/passive con replica logica Postgres + S3 cross-region
- **Air-gap mode**: tutte le dipendenze (npm/bun packages, modelli, immagini Docker) mirrorabili offline
- **Versione "appliance"**: ISO/OVF distribuibile, pre-configurato, per banche/gov

### 4.7 Capacity planning — reference sizing

Documento manca completamente. Serve una guida:

| Scala | Concurrent projects | Concurrent runners | Run/giorno | Sizing control plane | Sizing storage |
|---|---|---|---|---|---|
| Small (team singolo) | 5 | 2 | 50 | 2 vCPU / 4 GB / Postgres-small | 50 GB |
| Medium (10 team) | 50 | 20 | 500 | 8 vCPU / 16 GB / Postgres-medium + Redis | 500 GB |
| Large (banca / 100 team) | 500 | 200 | 5000 | HA cluster 3x16 vCPU / 64 GB / Postgres-HA + Kafka + S3 | 5 TB |

**Da fornire:** reference Helm chart + Terraform module + benchmark suite riproducibile.

### 4.8 Upgrade & schema migration

`aqa.sqlite` ha schema. Cosa succede quando passi da v0.3 a v0.4? Niente è detto.

**Specifica:**
- Schema versioning numerato (`schema_version` table)
- Migrations forward-only, idempotenti, transazionali
- `bunx aqa migrate status` / `bunx aqa migrate up` / `bunx aqa migrate down --to N` (down solo dev)
- Compatibility window: server N supporta runner N-2..N
- Breaking changes solo in major version, con deprecation period 1 minor version
- Migration di artefatti (es. schema scenario v1 → v2): tool `bunx aqa upgrade-artifacts --dry-run`

### 4.9 Multi-project resource quotas (self-hosted multi-team)

Anche dentro un singolo deploy enterprise, vari team/progetti competono per risorse. Senza quote:
- Un team avvia un release-gate enorme, blocca runner per tutti
- Bug LLM-loop di un progetto brucia il budget mensile dell'org

**Specifica quote per project:**

```yaml
quotas:
  default:
    concurrent_runs_max: 5
    concurrent_scenarios_max: 20
    storage_gb: 10
    llm_tokens_per_month: 10_000_000
    llm_cost_usd_per_month: 500
    artifact_retention_days: 30

  overrides:
    "crm-backend":
      concurrent_runs_max: 10
      llm_cost_usd_per_month: 2000
```

Enforcement a tre livelli: admission control (job rifiutati a coda), runtime (kill switch), reporting (anomaly detection).

---

## 5. Sicurezza & supply chain (enterprise table-stakes)

Non sono "opzionali per enterprise". Senza, il package non entra. Anche se non era il focus prioritario richiesto, devono stare nel blueprint.

### 5.1 Sandbox agentica reale

Sostituire `destructive: false` con **policy-driven sandbox**:

```yaml
sandbox:
  isolation: container          # container | vm | none-dev-only
  base_image: aqa/runtime:1.2-distroless
  filesystem:
    workdir_mode: ro_with_overlay
    allow_write: [".aqa/runs", ".aqa/tmp"]
    deny_read: [".env", "secrets/", "**/id_rsa*"]
  network:
    egress_policy: allowlist
    allow: ["localhost", "*.internal", "api.anthropic.com"]
    deny_default: true
  capabilities:
    drop: [SYS_ADMIN, NET_RAW, ...]
  resource_limits:
    cpu: 2
    memory_mb: 4096
    pids: 256
    timeout_seconds: 600
  seccomp_profile: aqa-default.json
```

L'implementazione iniziale può usare Docker/Podman; per enterprise air-gap considerare gVisor/Firecracker.

### 5.2 Supply chain pack — signing, scanning, allowlist

Un pack è un **prompt eseguibile**. Senza controlli, è un attack vector primario.

**Requisiti:**
- Pack signing con Sigstore/cosign (keyless OIDC)
- SBOM (CycloneDX) per ogni pack
- Pack scanning automatico (prompt injection patterns, malicious shell snippets, suspicious URLs)
- Enterprise allowlist: `aqa pack allowlist add <publisher>` — solo pack da publisher fidati
- Pinning per hash, non per version range
- Audit di ogni `aqa pack install`
- Pack execution review: i pack che includono `scripts/` arbitrari richiedono approvazione esplicita

### 5.3 Secret handling

**Regole:**
- Mai loggare secret (regex + entropy detection pre-write)
- Mai includere `.env` nelle artifact di replay (genera template `.env.example`)
- Secret scoping per scenario: lo scenario dichiara `requires_secrets: [STRIPE_TEST_KEY]`, il runner inietta solo quelli
- Integrazione Vault/AWS Secrets Manager/Azure Key Vault/GCP SM
- Pre-finding redaction: prima di salvare finding, passare per redaction pipeline (regex policy: AWS keys, JWT, email, CC, IBAN, PII configurabile)
- Audit ogni accesso a secret

### 5.4 Prompt injection difensiva

Il SUT può ritornare contenuto che inietta prompt nell'agente (tool result poisoning, document poisoning). AQA deve documentare e implementare difese:

- Tool result wrapping con marker espliciti `<tool_result trusted="false">...</tool_result>`
- System reminder periodici nel contesto agente
- Validazione output del SUT prima di inserirlo in contesto agente (length, encoding, pattern blacklist)
- "Untrusted boundary" segnata nei trace
- Test interni di prompt injection contro AQA stesso (red-team del red-teamer)

### 5.5 LLM data exfiltration prevention (DLP)

Il chiamare LLM cloud da codice enterprise = potenziale exfiltration. Soluzioni:

- **DLP pre-flight**: ogni payload verso LLM passa per redaction (secret, PII)
- **On-prem LLM support nativo**: vLLM, llama.cpp, Bedrock private, Azure OpenAI in VNet, Vertex private endpoints
- **BYOK** con keys nel customer's KMS
- **Air-gap mode**: nessuna chiamata internet, solo on-prem LLM
- **Audit completo**: ogni chiamata LLM = una entry in audit log con hash del prompt (non il prompt in chiaro)

### 5.6 SSO/IdP e identity

- SAML 2.0
- OIDC
- SCIM 2.0 provisioning
- Service accounts per runner (mTLS or short-lived OIDC tokens)
- MFA enforcement configurabile
- Session timeout, idle timeout, concurrent session limits

### 5.7 Audit log immutabile

```sql
CREATE TABLE audit_log (
  id           BIGSERIAL PRIMARY KEY,
  ts           TIMESTAMPTZ NOT NULL,
  actor_type   TEXT NOT NULL,   -- user | runner | system | agent
  actor_id     TEXT NOT NULL,
  action       TEXT NOT NULL,
  resource     TEXT NOT NULL,
  outcome      TEXT NOT NULL,
  payload      JSONB,
  prev_hash    BYTEA NOT NULL,  -- hash della riga precedente
  row_hash     BYTEA NOT NULL,  -- hash di (id, ts, ..., payload, prev_hash)
  signature    BYTEA            -- opzionale, firma con chiave HSM
);
```

- Append-only (revoca DELETE/UPDATE via permission)
- Hash chain verificabile (`aqa audit verify`)
- Export periodico a WORM storage (S3 Object Lock / Azure immutable blob)
- Eventi obbligatori: login, logout, role_change, secret_access, pack_install, prompt_change, riskmap_change, scenario_change, run_start, release_gate_decision, finding_status_change

---

## 6. Compliance, governance, audit

### 6.1 GDPR

- **Right to delete**: user data, findings tied to user, audit entries (eccetto immutabilità — usare anonymization con preservazione hash chain)
- **Data residency**: storage region pinnable per progetto/cliente
- **Consent**: per analytics, telemetry, sharing con vendor LLM
- **DPA**: template ready con vendor LLM (BYOK = customer controller, vendor processor)
- **PII tagging**: artefatti taggati per sensibilità

### 6.2 SOC2 Type 2 / ISO 27001

- Change management: ogni modifica a prompt/skill/risk-map/scenari = audit + reviewer
- Separation of duties: chi approva il release-gate ≠ chi esegue scenari ≠ chi modifica risk-map (role-based)
- Vulnerability management: dependabot/renovate + scanning settimanale
- Penetration test annuale (per la piattaforma AQA stessa)
- Business continuity / DR plan documentato

### 6.3 Settori regolati

| Settore | Requisito extra | Specifica |
|---|---|---|
| Finance (PCI-DSS) | Tokenizzazione PAN, no log di carte | Redaction rule built-in |
| Healthcare (HIPAA) | PHI handling, BAA con vendor LLM | On-prem LLM obbligatorio |
| Public Sector (FedRAMP-style) | FIPS 140-2 crypto, air-gap | Distribuzione "appliance" |
| EU (DORA, NIS2) | Incident reporting < 24h | Hook automatico per export incident |

### 6.4 Chain of custody per security findings

Findings di sicurezza che entrano in incident response devono avere:
- Hash criptografico di tutti gli artefatti
- Timestamping (RFC 3161 TSA)
- Firma del runner (mTLS certificate + signed manifest)
- Catena di custodia immutabile in audit log
- Export "evidence bundle" firmato (`bunx aqa export-evidence AQA-2026-0001 --sign`)

---

## 7. Gap di architettura non-funzionali

### A1. Schema-first commitment (ADR-004)

Source of truth:
- **JSON Schema 2020-12** per tutti gli artefatti (risk-map, scenario, finding, event, run, pack manifest)
- **OpenAPI 3.1** per HTTP API (control plane + runner)
- **AsyncAPI 3.0** per eventi (streaming, queue)
- **Protobuf** opzionale per traffico runner⇄server ad alta frequenza

Codegen out-of-the-box per:
- TypeScript (kit + admin)
- Python (per SDK client + script in repo Python)
- Go (per runner alternativi)
- Java (enterprise integrations)

Repository struttura:

```
schemas/
  v1/
    risk-map.schema.json
    scenario.schema.json
    finding.schema.json
    event.schema.json
    run.schema.json
    pack-manifest.schema.json
    openapi.yaml
    asyncapi.yaml
  v2-draft/
    ...
```

Schema validation in ogni boundary I/O. Refused = 400.

### A2. Runtime: oltre Bun-only

**Raccomandazione (ADR-005):** target di compatibilità

- **Tier 1**: Bun ≥ 1.x (primary dev experience)
- **Tier 1**: Node ≥ 22 LTS (enterprise default)
- **Tier 2**: Distribution come single-binary (bun build --compile o Deno compile o pkg) per air-gap

Codice deve essere runtime-agnostic dove possibile. Driver SQLite: `better-sqlite3` per Node, `bun:sqlite` per Bun, dietro adapter comune.

### A3. Plugin/extension API formale

Oltre ai pack, l'engine ha bisogno di extension points:

```typescript
// Plugin types
interface OracleProvider {
  type: string;
  evaluate(args, context): Promise<OracleResult>;
  schema: JSONSchema;
}

interface ProbeProvider { ... }
interface AdapterProvider { ... }   // per nuovi agent target
interface ReporterProvider { ... }
interface StoreProvider { ... }
interface QueueProvider { ... }
interface SecretProvider { ... }
```

Plugin discovery via npm/bun package + manifest `aqa.extensions.json` in package.json.

### A4. Event bus / pub-sub per scale

`events.jsonl` non scala. Necessario backend pluggable:

- **Local/single-runner**: file jsonl tail
- **Self-hosted small**: Postgres LISTEN/NOTIFY
- **Self-hosted medium**: Redis Streams o NATS JetStream
- **Self-hosted large**: Kafka

Tutti consumano lo stesso `EventBus` interface. UI admin sottoscrive con SSE/WebSocket sopra.

### A5. Federation / multi-cluster (enterprise scale)

Per org con team distribuiti geo (EU + US + APAC):

- Federazione di control plane regionali con replication asincrona di metadata (non di codice cliente)
- Run sempre eseguiti in region del progetto
- Read API globale, write API regionale

Specifica futura (post v1.0) ma il design v0.x deve permetterla — niente hardcoded "single region".

### A6. Idempotency e API design

Tutte le API POST/PATCH devono accettare `Idempotency-Key` header e garantire dedup per N giorni. Esplicito in OpenAPI spec.

### A7. Webhook outbound per integrazioni

Slack/Teams/Jira/Linear/PagerDuty/ServiceNow/email integrations devono passare per un sistema webhook:

- Outbound webhook con retry esponenziale, DLQ
- HMAC signing
- Per-integration template
- Rate limiting per evitare flood

---

## 8. Gap di metodologia QA / dominio testing

### M1. Risk discovery — manca metodologia strutturata

Il doc lascia la generazione della risk-map a "l'agente guarda il repo e indovina". Per enterprise serve:

**Framework supportati nativamente:**

| Framework | Per cosa | Output AQA |
|---|---|---|
| **STRIDE** | Security threats | risk areas con tag `category=spoofing|tampering|repudiation|information_disclosure|denial_of_service|elevation_of_privilege` |
| **FMEA** | Reliability/safety | risk areas con `severity * occurrence * detection = RPN` |
| **Attack trees** | Adversarial security | scenari come path nell'albero |
| **OWASP Top 10 (web)** | App security | pack security pre-configurato |
| **OWASP Top 10 Agentic (2026)** | LLM agent security | pack llm-agent pre-configurato |
| **MITRE ATT&CK / ATLAS** | Adversarial ML | scenario library |

CLI:

```
bunx aqa risk discover --method stride --scope src/api
bunx aqa risk discover --method fmea --component payment
bunx aqa risk import --owasp-top10
```

### M2. Coverage measurement formale

"Covered/uncovered" è binario nel doc. Serve di più:

```yaml
risk_coverage:
  risk_id: cross-tenant-access
  invariants_count: 3
  invariants_with_scenarios: 3
  scenarios_count: 12
  scenarios_with_oracles: 12
  scenarios_with_deterministic_replay: 10
  last_run_days_ago: 0
  pass_rate_30d: 0.99
  flaky_count: 0
  coverage_score: 0.92         # formula documentata
  status: covered              # covered | partial | gap | stale
  drift_alerts:
    - "Probe count decreased from 8 to 5 in last commit"
```

Aggregato a livello pack/project/org.

### M3. Findings dedup e root-cause clustering

Senza, lo stesso bug appare 10 volte. Specifica:

- **Fingerprinting**: hash di (risk_id, scenario_id, error_signature, stack_trace_normalized)
- **Clustering**: similarity-based (embedding di evidence) per raggruppare findings semanticamente uguali
- **Root cause linking**: findings linkati a un `root_cause_id`; quando un fix risolve il root cause, tutti i findings si chiudono insieme
- **Bayesian prioritization**: ordinare findings per `severity * confidence * blast_radius / cost_to_fix_estimate`

### M4. Integrazione con test infrastructure esistente

Il doc dice "non sostituiamo Jest/Pytest/Playwright" ma non specifica **come** li integra:

| Tool | Modalità integrazione | Output AQA |
|---|---|---|
| Jest/Vitest/bun:test | Ingest JUnit XML / `--json` | Coverage data, failure linking |
| Pytest | Ingest JUnit XML / pytest plugin | Same |
| Playwright | Ingest trace.zip | Replay file built-in |
| k6/Locust | Ingest summary.json | Performance findings |
| Hypothesis/fast-check | Shrinking di counterexample | Bug minimization |
| Stryker/mutmut | Mutation score → risk coverage | "Untested mutations = risk" |
| Snyk/Trivy/Semgrep | SAST/SCA findings ingestion | Risk areas auto-populated |

CLI:

```
bunx aqa ingest junit ./test-results/junit.xml
bunx aqa ingest playwright ./trace.zip
bunx aqa ingest sast --tool semgrep --file semgrep-results.json
```

### M5. Bug → fix → verify-fix loop

Il loop si chiude solo quando il bug è fixato e la regressione passa. Doc lascia "qualcuno scrive il fix" senza orchestrare.

**Specifica workflow:**

```
finding.created (status=new)
  → finding.verified (status=verified, regression test draft created)
  → fix branch opened (auto comment on related risk-map, link in PR)
  → CI runs aqa run --finding AQA-2026-0001 → finding.fix_verified
  → PR merge → finding.closed
  → 7-day later → finding.retest passes → status stays closed
  → if regresses → finding.regressed → reopen + alert
```

Integrazione GitHub/GitLab/Bitbucket per:
- PR status checks dedicati `aqa/release-gate`, `aqa/smoke`
- PR commenti automatici con findings nuovi
- Branch protection rule template

### M6. Pack mancanti per enterprise

Il doc lista 6 pack base. Per enterprise serve coverage molto più ampia. Roadmap pack consigliata:

| Pack | Priorità | Note |
|---|---|---|
| `data-pipeline` (ETL, Airflow, dbt) | Alta | Data drift, schema breaking changes |
| `database-migrations` | Alta | Forward/backward migration safety |
| `infra-iac` (Terraform, Pulumi, CDK) | Alta | Plan diff testing, drift detection |
| `kubernetes` (Helm, Kustomize) | Alta | Manifest validation, OPA/Gatekeeper, chaos |
| `mobile-native` (iOS, Android, RN, Expo) | Media | UI + offline + permission flows |
| `desktop` (Electron, Tauri) | Media | Auto-update, IPC, sandboxing |
| `realtime` (WebSocket, SSE, gRPC streaming) | Media | Connection lifecycle, backpressure |
| `compliance-pci` | Alta (regulated) | PAN/CVV redaction, segmentation tests |
| `compliance-hipaa` | Alta (regulated) | PHI handling tests |
| `compliance-gdpr` | Alta (EU) | DSAR, right to delete, consent |
| `accessibility-wcag` | Media | axe-core ingestion, keyboard nav scenarios |
| `i18n-l10n` | Media | Locale matrix testing |
| `performance` | Alta | k6/Locust integration, p95/p99 SLO checks |
| `chaos` | Media | Toxiproxy/LitmusChaos integration |
| `ml-pipeline` | Bassa | Data drift, model drift, training reproducibility |

### M7. Test data management

Hand-wavy nel doc. Specifica:

- **Fixtures versionati** in `.aqa/fixtures/` con schema validation
- **Factories** type-safe (es. integrazione con `@faker-js/faker`, `factory-girl`)
- **Anonymization** di dati production-like (preserva distribuzioni statistiche, anonimizza PII)
- **Snapshot management**: `aqa fixtures snapshot --env staging --anonymize` + `restore`
- **Tenant isolation**: ogni scenario può chiedere "scratch tenant" effimero

---

## 9. Capability matrix agent target

Il doc accenna a Claude/Codex/Gemini/Copilot ma non formalizza le differenze di capacità, che impattano cosa AQA può promettere.

| Feature | Claude Code | Codex CLI | Gemini CLI | Copilot CLI |
|---|---|---|---|---|
| Skills `SKILL.md` | ✅ nativo | ✅ nativo | ✅ recente | ✅ recente (legge anche .claude/skills) |
| Subagents | ✅ nativo, isolated context | ⚠️ esplicito, manuale | ✅ recente | ✅ custom agents `.agent.md` |
| Slash commands | ✅ | ⚠️ via skills | ✅ `.toml` | ✅ |
| Hooks | ✅ rich event model | ⚠️ limitato | ⚠️ limitato | ✅ `.github/hooks/*.json` |
| MCP servers | ✅ native | ✅ native | ✅ native | ✅ native |
| Plugins installabili | ✅ | ✅ native (best-in-class) | ⚠️ in evoluzione | ⚠️ in evoluzione |
| Sandbox primitives | ✅ permission modes | ✅ sandbox+approval | ⚠️ limitato | ✅ via GitHub |
| Auto-trigger su filename | ⚠️ via skill description | ⚠️ | ⚠️ | ⚠️ |
| Cost transparency | ⚠️ | ⚠️ | ⚠️ | ❌ subscription model |
| Offline / on-prem model | ❌ (cloud-only) | ❌ (cloud-only) | ❌ (cloud-only mostly) | ❌ (cloud-only) |

**Conseguenza per AQA:**

1. **Capability negotiation runtime**: AQA, prima di lanciare un workflow, interroga il target ("hai subagents? quanti paralleli? hooks? quali?") e degrada gracefully.
2. **Adapter capability profile** in YAML: ogni adapter espone le sue capacità, il kit usa solo quelle compatibili.
3. **No "lowest common denominator"**: meglio specializzare per target che fare il minimo comune.
4. **Modalità orchestrator** (B) come fallback universale: se l'agente target non ha la feature, lo fa il kit stesso.

---

## 10. Reference architecture — Enterprise self-hosted

```
┌─────────────────────────────────────────────────────────────────┐
│                    Customer Perimeter (VPC/DC)                  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Control Plane (HA, 3 replicas)              │   │
│  │  ┌──────────────────┐  ┌────────────────────────────┐    │   │
│  │  │  aqa-server      │  │  aqa-admin (React SPA)     │    │   │
│  │  │  (Hono/Bun       │  │  served via nginx/CDN      │    │   │
│  │  │   or Node)       │  └────────────────────────────┘    │   │
│  │  │                  │                                    │   │
│  │  │  - OpenAPI       │  ┌────────────────────────────┐    │   │
│  │  │  - AsyncAPI      │  │  aqa-scheduler             │    │   │
│  │  │  - SSE/WS        │  │  (job assignment, fairness)│    │   │
│  │  │  - mTLS          │  └────────────────────────────┘    │   │
│  │  └──────────────────┘                                    │   │
│  │                                                          │   │
│  │  ┌──────────────┐ ┌─────────────┐ ┌──────────────────┐   │   │
│  │  │ Postgres HA  │ │ Redis/NATS  │ │ S3-compat (MinIO)│   │   │
│  │  │ (Patroni)    │ │ (queue+bus) │ │ (artifacts+WORM) │   │   │
│  │  └──────────────┘ └─────────────┘ └──────────────────┘   │   │
│  │                                                          │   │
│  │  ┌──────────────┐ ┌─────────────┐ ┌──────────────────┐   │   │
│  │  │ Vault/KMS    │ │ OIDC/SAML   │ │ OTel Collector   │   │   │
│  │  │ (secrets)    │ │ (SSO IdP)   │ │ + Prometheus     │   │   │
│  │  └──────────────┘ └─────────────┘ │ + Loki + Tempo   │   │   │
│  │                                   └──────────────────┘   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                            ▲                                    │
│                            │ mTLS + OIDC                        │
│             ┌──────────────┼──────────────┐                     │
│             │              │              │                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │  Runner #1   │  │  Runner #2   │  │  Runner #N   │           │
│  │  (per team   │  │  (CI shared  │  │  (dev laptop │           │
│  │   dedicato)  │  │   pool)      │  │   on-demand) │           │
│  │              │  │              │  │              │           │
│  │  - exec      │  │  - exec      │  │  - exec      │           │
│  │  - sandbox   │  │  - sandbox   │  │  - sandbox   │           │
│  │  - LLM call  │  │  - LLM call  │  │  - LLM call  │           │
│  │     (BYOK)   │  │     (BYOK)   │  │     (user)   │           │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
│         │                  │                  │                 │
│         ▼                  ▼                  ▼                 │
│  ┌────────────────────────────────────────────────────────┐     │
│  │   Customer code / SUT (mai esce dal perimetro)         │     │
│  └────────────────────────────────────────────────────────┘     │
│                                                                 │
│  ┌────────────────────────────────────────────────────────┐     │
│  │   LLM Backend (configurable per project)               │     │
│  │   - Anthropic API (BYOK)                               │     │
│  │   - OpenAI API (BYOK)                                  │     │
│  │   - Azure OpenAI (private endpoint)                    │     │
│  │   - AWS Bedrock (private endpoint)                     │     │
│  │   - Google Vertex AI (private endpoint)                │     │
│  │   - On-prem: vLLM/llama.cpp/TGI                        │     │
│  └────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────┘
```

**Componenti chiave self-hosted:**

| Componente | Tech | Note |
|---|---|---|
| `aqa-server` | Hono+Bun OR Express+Node | HA dietro load balancer, stateless |
| `aqa-admin` | React 19 + Vite | Statico, served da nginx |
| `aqa-scheduler` | Stateless, sceglie runner per job | Eligible per HPA |
| `aqa-runner` | Container o systemd service | Eseguibile anche fuori K8s |
| Storage SQL | Postgres 16 HA (Patroni o managed) | Schema `aqa` |
| Queue | Postgres LISTEN/NOTIFY → Redis Streams → Kafka per scala | Pluggable |
| Artifact | S3-compatible (MinIO per air-gap) | Versioned bucket, Object Lock per WORM |
| Secret | Vault / cloud KMS | mai in DB |
| IdP | OIDC primary, SAML supported | SCIM provisioning |
| Telemetry | OTel Collector → Prometheus/Tempo/Loki | Dashboard shipped |
| Egress | Solo per LLM cloud (con allowlist) | Air-gap option disabilita |

**Deployment:**
- Helm chart ufficiale (`agentic-qa-kit` chart)
- Terraform module ufficiale per AWS/Azure/GCP
- Docker Compose per single-node demo
- Air-gap installer (script bash + tar bundle)

---

## 10bis. Struttura dei package — analisi comparativa

La proposta originale prevede 4 pacchetti: `agentic-qa-kit`, `agentic-qa-kit-admin`, `agentic-qa-kit-server`, AQA Cloud. Per enterprise self-hosted questa struttura va rivista. Presento qui due opzioni con tradeoff espliciti perché la scelta impatta supply chain, signing, dependency management e UX di installazione.

### Opzione A — Struttura minimale (4 pacchetti, conservativa)

```
agentic-qa-kit            → CLI + engine + runner locale + adapters + packs built-in
agentic-qa-kit-admin      → React UI (statica)
agentic-qa-kit-server     → API control plane (obbligatorio in multi-team)
agentic-qa-kit-cloud      → ex "AQA Cloud" → distribuzione Helm/Terraform del server
                            (non è un prodotto separato in self-hosted, è il deployment kit)
```

**Pro:**
- Curva di apprendimento bassa, README breve
- Meno dependency surface
- `bun add -d agentic-qa-kit` è tutto quello che serve per partire (modalità dev locale)
- Update coordinato: un release tag bumpa tutto insieme

**Contro:**
- **Pack signing granulare impossibile**: tutti i pack built-in sono firmati con la stessa chiave della release. Un compromesso = compromesso totale.
- **SDK in altri linguaggi assente**: chi vuole chiamare l'API da Python deve scrivere il client manualmente
- **Runner non upgradabile separatamente dal server**: in enterprise con runner distribuiti tra team, un upgrade del server forza upgrade di tutti i runner
- **`agentic-qa-kit` bundle pesante**: pulling 50 MB anche se vuoi solo il runner in CI
- **Refactor interno difficile**: tutto è importato come "agentic-qa-kit/*", refactoring rompe API pubblica anche per cambi interni
- **Schemas non riusabili**: chi vuole solo validare YAML deve installare l'intero kit

### Opzione B — Struttura enterprise (8-10 pacchetti, granulare)

```
agentic-qa-kit            → CLI binaria (thin shell, dispatch a core)
agentic-qa-kit-core       → engine, store abstraction, oracle/probe registry,
                            sandbox runtime, replay (libreria importabile)
agentic-qa-kit-runner     → eseguibile standalone per CI/laptop/K8s,
                            consuma core + chiama server via API
agentic-qa-kit-server     → API control plane (Hono/Bun + Postgres) - obbligatorio multi-team
agentic-qa-kit-admin      → React SPA (statica, può essere servita anche da server)
agentic-qa-kit-schemas    → JSON Schema + OpenAPI + AsyncAPI versionati,
                            zero deps, riusato da tutti
agentic-qa-kit-sdk-ts     → SDK TypeScript per API server (codegen da schemas)
agentic-qa-kit-sdk-python → SDK Python (codegen da schemas) - critico per progetti Python
agentic-qa-kit-sdk-go     → SDK Go (codegen da schemas) - per runner alternativi
                            e integrazioni infra

@aqa/pack-core            → pack base, firmato separatamente, sigstore
@aqa/pack-api             → pack per REST/GraphQL
@aqa/pack-web-ui          → pack web UI
@aqa/pack-llm-agent       → pack agenti LLM
@aqa/pack-security        → pack security
@aqa/pack-rewrite-migration
@aqa/pack-compliance-gdpr
@aqa/pack-compliance-pci
@aqa/pack-compliance-hipaa
@aqa/pack-database-migrations
@aqa/pack-infra-iac
@aqa/pack-kubernetes
@aqa/pack-performance
@aqa/pack-accessibility-wcag
@aqa/pack-mobile-native
... (ogni pack è un package npm separato, signed, versioned, sbom)

Deployment artifacts (non npm):
deploy/helm/agentic-qa-kit           → Helm chart ufficiale
deploy/terraform/aws|azure|gcp       → Terraform modules
deploy/airgap/                       → Bundle offline (tar + script)
deploy/docker-compose.yml            → Demo single-node
```

**Pro:**
- **Pack signing per-pack**: ogni pack ha la sua chiave + SBOM + cosign signature. Un pack compromesso non compromette gli altri.
- **Supply chain audit-friendly**: enterprise può allowlist-are pack singoli (`@aqa/pack-core`, `@aqa/pack-api`) e bloccare community packs
- **SDK multi-lingua**: Python project usa `agentic-qa-kit-sdk-python` per chiamare il server senza bundling JS
- **Upgrade indipendente**: runner v0.4.2 + server v0.5.0 coesistono (compatibility window ADR-014)
- **Bundle minimale**: in CI installi solo `agentic-qa-kit-runner` (~5 MB), non l'intero kit
- **Refactor sicuro**: API pubblica = solo ciò che è in `core`, `sdk-*`, `schemas`. Resto è interno.
- **Schemas riusabili**: tool esterni possono importare `agentic-qa-kit-schemas` per validare YAML senza dipendere dal kit
- **Pack marketplace governance possibile**: separazione enforcement (kit non installa pack non-allowlisted)
- **Distribuzione air-gap pulita**: bundle solo i pacchetti necessari

**Contro:**
- Monorepo più complesso (workspaces Bun/pnpm, build pipeline, versioning coordinato)
- Onboarding contributor più ripido
- Possibili problemi di compatibilità versione tra pacchetti (mitigato da SemVer rigoroso + compat window)
- Dependency hell potenziale se non gestita (mitigato da peer dependencies su `schemas` e `core`)
- README e docs più lunghi (mitigato da "quick start" che mostra solo CLI + 1 pack)

### Confronto sintetico

| Aspetto | Opzione A (4) | Opzione B (8-10 + N packs) |
|---|---|---|
| Onboarding utente community | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| Onboarding contributor | ⭐⭐⭐⭐ | ⭐⭐ |
| Pack supply chain audit | ⭐ | ⭐⭐⭐⭐⭐ |
| SDK multi-language | ⭐ | ⭐⭐⭐⭐⭐ |
| Bundle size CI | ⭐⭐ | ⭐⭐⭐⭐⭐ |
| Upgrade flexibility | ⭐⭐ | ⭐⭐⭐⭐⭐ |
| Enterprise installability | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| Compliance audit (SOC2, ISO) | ⭐⭐ | ⭐⭐⭐⭐⭐ |
| Refactoring interno | ⭐⭐ | ⭐⭐⭐⭐⭐ |
| Costo manutenzione monorepo | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| Time-to-first-release | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |

### Opzione C (consigliata) — Ibrida progressiva

In pratica nessuna delle due opzioni pure è ottimale. La strada consigliata è:

**v0.1 — Avvio con struttura minimale (3 pacchetti):**

```
agentic-qa-kit          → CLI + engine + runner + adapters + packs built-in (Opzione A)
agentic-qa-kit-schemas  → fin da subito separato (ZERO deps, riusato da tutto)
agentic-qa-kit-admin    → React SPA (può attendere v0.4 in realtà)
```

Il server non esiste ancora come pacchetto separato perché in v0.1 il kit è local-first. AQA Cloud non esiste come prodotto.

**v0.3 — Estrarre quando l'enterprise table-stakes lo richiede:**

```
+ agentic-qa-kit-core       (estratto da agentic-qa-kit)
+ agentic-qa-kit-server     (nuovo, separato per HA deployment)
+ agentic-qa-kit-runner     (estratto, runner standalone)
+ agentic-qa-kit-sdk-ts     (codegen da schemas)
```

**v0.4 — Pack come pacchetti separati per supply chain:**

```
- packs built-in spostati a @aqa/pack-* npm packages
+ pack signing infrastructure (sigstore + SBOM)
+ pack allowlist enforcement nel kit
```

**v0.5+ — SDK Python/Go quando ci sono utenti reali che li chiedono:**

```
+ agentic-qa-kit-sdk-python   (solo se >= 3 enterprise lo richiedono)
+ agentic-qa-kit-sdk-go       (solo se runner alternativi lo richiedono)
```

**Razionale Opzione C:**
- Frontloading di `schemas` come pacchetto separato è gratis ma elimina debt enorme dopo
- Non estrai prematuramente (YAGNI applicato a packaging)
- Estrai quando il dolore lo giustifica (pack signing forza pack come npm packages; HA deployment forza server separato)
- L'utente community in v0.1 vede 1 pacchetto da installare (`agentic-qa-kit`), il refactor di estrazione è invisibile a chi importa via CLI

### Sull'ex "AQA Cloud"

Per il target self-hosted enterprise, **AQA Cloud non è un pacchetto né un prodotto**. È:

- Un **deployment kit** (Helm chart + Terraform module + air-gap installer) sotto `deploy/`
- Un **bundle di compose** che mette insieme `agentic-qa-kit-server` + Postgres + Redis + MinIO + OTel Collector
- **Non** un'offering SaaS tua. Se in futuro vorrai farne una SaaS, sarà un repo separato proprietario (`agentic-qa-cloud-saas`), che internamente userà gli stessi packages open source.

La separazione open-source / commercial offering è importante per:
- Chiarezza di licensing (Apache-2.0 puro per gli OSS packages)
- Trust della community (no "rug pull" da open a closed)
- Possibilità di self-host completo per chi non vuole comprare la SaaS

---

## 11. Threat model sintetico (STRIDE applicato ad AQA)

| Categoria | Minaccia | Mitigazione |
|---|---|---|
| **Spoofing** | Runner si finge di essere autorizzato per progetto X | mTLS + short-lived OIDC token + runner identity scoping per project |
| **Spoofing** | LLM response spoofing (man-in-the-middle) | TLS pinning, response validation contro schema |
| **Tampering** | Modifica pack/skill da Mr. Robot interno | Pack signing + audit log immutabile + RBAC su `prompt.edit` |
| **Tampering** | Modifica retroattiva di findings | Audit log hash-chained, finding storia immutabile (CRDT-like) |
| **Repudiation** | "Non ho approvato io quel release-gate" | Audit log firmato + SSO con MFA + signed manifests |
| **Information Disclosure** | Secret in log/screenshot exfiltrati a vendor LLM | Pre-LLM redaction, BYOK on-prem option, audit chiamate LLM |
| **Information Disclosure** | Pack malicious legge .env e lo manda via tool shell | Sandbox fs caps + egress allowlist + secret denylist |
| **DoS** | Agent in loop esaurisce LLM budget | Cost kill-switch + tool-call rate limit + dead-man timer |
| **DoS** | Runner consuma CPU/RAM, blocca altri progetti | Resource quota per project + container limits |
| **Elevation of Privilege** | Runner accede a finding di altro tenant | Tenant scoping a livello query, audit di cross-tenant access |
| **Elevation of Privilege** | Skill modifica RBAC tramite tool call | Tool allowlist per skill, `admin.*` tools mai disponibili a skill non-admin |

**Da fornire:**
- Threat model documento completo (50+ minacce)
- Penetration test report annuale (post v1.0)
- Bug bounty program (post v1.0)
- CVE disclosure policy

---

## 12. SLO/SLI proposti per la piattaforma

(Già introdotti in §4.5; qui formalizzati come SLA template)

```yaml
slos:
  control_plane_api_availability:
    objective: 99.9%
    window: 30d
    measurement: "successful_requests / total_requests"
    error_budget_burn_alerts: [2x, 10x]

  run_start_latency:
    objective: "p95 < 30s"
    measurement: span(job.scheduled → scenario.started)

  scenario_execution_success_rate:
    objective: 99.5%
    excluding: [findings_legitimate, user_cancel]

  bug_level_replay_success_rate:
    objective: 95%
    verified_findings_only: true

  finding_triage_time_p0:
    objective: "p95 < 1h"
    requires_notification: true

  finding_triage_time_p1:
    objective: "p95 < 4h"

  llm_call_success_rate:
    objective: 98%
    excluding: [budget_exceeded, user_cancel]

  runner_heartbeat_freshness:
    objective: "99% < 60s"
```

Dashboard Grafana fornita out-of-the-box.

---

## 13. Compliance matrix

| Requisito | Standard | Implementazione AQA | Stato target v1.0 |
|---|---|---|---|
| Audit log immutabile | SOC2 CC7, ISO 27001 A.12.4 | Hash-chained postgres + WORM S3 | Required |
| Access control RBAC | SOC2 CC6.1 | Org/role/permission matrix | Required |
| Encryption at rest | SOC2 CC6.7 | Postgres TDE + S3 SSE-KMS | Required |
| Encryption in transit | SOC2 CC6.7 | TLS 1.3 + mTLS runner | Required |
| Secret management | SOC2 CC6.1 | Vault/KMS, no secrets in DB/logs | Required |
| Change management | SOC2 CC8.1 | Prompt/skill/riskmap versioning + reviewer | Required |
| Backup & recovery | SOC2 A1.2 | Daily backup + WAL + restore drill | Required |
| Vulnerability mgmt | SOC2 CC7.1 | SCA/SAST in CI + dependabot | Required |
| Incident response | SOC2 CC7.4 | Runbook + alert + audit | Required |
| Right to delete | GDPR Art.17 | User/PII delete API + anonymization | Required |
| Data residency | GDPR + ePrivacy | Region-pinnable storage | Required |
| Logging PII redaction | GDPR Art.5 | Pre-write redaction pipeline | Required |
| Data classification | ISO 27001 A.8.2 | Artifact tagging | Required |
| Separation of duties | SOC2 CC1.3 | Role split: maintainer ≠ release-approver | Required |
| FIPS 140-2 crypto | FedRAMP | OpenSSL FIPS module option | Optional (gov tier) |
| HIPAA BAA | HIPAA | On-prem LLM mandatory | Optional (healthcare) |
| PCI-DSS SAQ-D | PCI | Network segmentation, no PAN logging | Optional (finance) |

---

## 14. ADR (Architecture Decision Records) da scrivere

Lista degli ADR che devono essere scritti **prima del primo commit di produzione**:

| ADR | Titolo | Decisione chiave |
|---|---|---|
| ADR-001 | Execution mode: dual (agent vs orchestrator) | Esplicito per profile/scenario, orchestrator default per release-gate |
| ADR-002 | Oracle chain & LLM-as-judge policy | Deterministic-first, ensemble per semantic, no solo-LLM in release |
| ADR-003 | Storage abstraction | SQLite local, Postgres self-hosted, S3 artifact, pluggable |
| ADR-004 | Schema-first | JSON Schema + OpenAPI + AsyncAPI source of truth, codegen multi-lang |
| ADR-005 | Runtime targets | Bun T1 + Node T1 + single-binary T2 |
| ADR-006 | Sandbox model | Container-per-scenario default, gVisor/Firecracker option |
| ADR-007 | Pack supply chain | Sigstore signing, SBOM, allowlist enterprise |
| ADR-008 | Cost governance | Per-org/project/profile budget, hard kill-switch |
| ADR-009 | Determinism contract | 3-level replay (bug/scenario/agent), bug-level required per verified |
| ADR-010 | Audit log | Hash-chained, WORM-exportable, append-only RBAC |
| ADR-011 | Observability | OTel native, Prometheus naming, dashboards/alerts shipped |
| ADR-012 | LLM backend abstraction | BYOK, on-prem option, DLP redaction pipeline |
| ADR-013 | RBAC model | Org > project > role > permission, SSO+SCIM |
| ADR-014 | Versioning & migration | SemVer, schema migration forward-only, N-2 compat |
| ADR-015 | Multi-tenancy isolation | Row-level + connection scoping + per-project quota |
| ADR-016 | Agent capability negotiation | Runtime per-target, graceful degradation |
| ADR-017 | Event bus pluggability | jsonl→pg-notify→redis-streams→kafka |
| ADR-018 | Findings dedup & root-cause | Fingerprint + embedding similarity + root_cause_id linking |
| ADR-019 | Risk methodology | STRIDE/FMEA/OWASP frameworks first-class |
| ADR-020 | Pack execution risk profile | `scripts/` arbitrari richiedono approval esplicita |

---

## 15. Roadmap enterprise rivista

La roadmap originale è community-first e accelera troppo verso feature "wow" (AI generation, cloud) prima di mettere fondamenta. Riscrittura:

### v0.1 — Foundations (8-10 settimane)
**Goal:** scaffolder solido, schemi versionati, sandbox di base, sicurezza minima.

- `aqa init`, `aqa doctor`, `aqa generate`, `aqa validate`
- Schema JSON ufficiali + validazione runtime
- Pack base: `core`, `api`, `web-ui`, `llm-agent`, `security`
- Adapter: Claude, Codex (gli altri in v0.2)
- Sandbox: container-per-scenario opzionale (default off, on per `security` profile)
- Pack signing infrastructure (chiavi + verifica, senza ancora richiederlo)
- Audit log hash-chained dal giorno 1
- Documentazione: getting-started, security overview, ADR-001..010

### v0.2 — Structured runs + determinism contract (6-8 settimane)
**Goal:** run riproducibili a livello bug e scenario, no LLM determinism falsa promessa.

- `aqa run --profile X` con isolation strategies
- `aqa replay` con 3-level reproducibility
- `aqa verify` con verification_floor check
- Schema finding esteso (reproducibility + provenance)
- Cost tracking base (tokens + USD per run)
- Flake detection + auto-quarantine
- Adapter: Gemini, Copilot
- Pack: `rewrite-migration`, `data-pipeline`
- Observability: OTel base, Prometheus metrics core

### v0.3 — Enterprise table-stakes (10-12 settimane)
**Goal:** rendere il package installabile in azienda regolata.

- Postgres backend (oltre SQLite)
- S3-compatible artifact store
- SSO/OIDC + RBAC granulare
- Secret management (Vault integration)
- Cost governance hard-enforced (kill-switch)
- Pack signing **obbligatorio** + scanning
- On-prem LLM adapter (vLLM, llama.cpp)
- BYOK con Vault/KMS
- Audit log WORM export
- DLP pre-LLM redaction
- Sandbox container default-on per security/release
- Helm chart + Terraform module + air-gap installer
- Pack: `compliance-gdpr`, `compliance-pci`

### v0.4 — Admin UI (6-8 settimane)
**Goal:** cabina di controllo, viewer prima, editor dopo.

- agentic-qa-kit-admin viewer: dashboard, runs, findings, risk-map, scenarios, timeline live
- agentic-qa-kit-server API (OpenAPI fully spec'd)
- Live SSE/WebSocket timeline
- Replay viewer
- Cost report dashboard
- Audit log explorer
- Quotas enforcement con UI
- Wizard onboarding (Modello B = orchestrator)
- AI-generation feature in **draft mode only**, mai apply senza review

### v0.5 — Cloud-ready (single-tenant self-hosted multi-team) (8-10 settinane)
**Goal:** multi-progetto, multi-runner, multi-team, dentro un perimetro enterprise.

- Org/client/project/role/permission completi
- Runner fleet management
- Job queue con priority + fairness + DLQ
- Findings dedup/clustering/root-cause
- Bug → fix → verify-fix loop integrazione PR
- Webhook outbound (Slack/Teams/Jira/PagerDuty)
- Pack: `database-migrations`, `infra-iac`, `kubernetes`, `performance`, `accessibility-wcag`
- Grafana dashboards + Prometheus rules shipped
- DR runbook + restore drill tooling

### v0.6 — Methodology rigor (6 settimane)
**Goal:** elevare la metodologia QA, non solo il toolkit.

- Risk discovery con STRIDE/FMEA/OWASP framework integration
- Coverage measurement formale + drift detection
- Oracle ensemble + calibration tooling
- LLM judge calibration suite (gold standard, reliability diagrams)
- Bug minimization automated (shrinking algorithm)
- Mutation testing integration

### v1.0 — Production-ready enterprise (4-6 settimane di hardening)
**Goal:** GA per enterprise. Penetration test, security audit, compliance attestations.

- Pen test esterno + remediation
- SOC2 Type 1 audit (Type 2 a +12 mesi)
- ISO 27001 readiness
- Bug bounty
- SLA legali
- Reference customers + case studies
- Pack: `compliance-hipaa`, restanti tier-2 packs

### Post-v1.0 — Ecosystem & federation
- Pack marketplace (validato, signed)
- Multi-region federation
- AQA MCP server pubblico
- Copilot Cloud Agent integration
- Cloud SaaS offering (se voluto)

**Cosa è ESPLICITAMENTE rimandato:**
- Marketplace community **fino a dopo** pack signing + scanning
- AI-generation auto-apply (sempre review umana)
- Cross-region active/active (post v1.0)
- Mobile-native pack (post v0.5)
- LLM judge come unica oracle (mai)

---

## 16. Metriche di successo

### Prodotto

| Metrica | Target v1.0 | Misurato come |
|---|---|---|
| **Verified useful bugs / human triage hour** | ≥ 3 | bug verificati genuini ÷ ore di triage |
| **False positive rate** | < 15% | findings rejected / total findings |
| **Time-to-first-value** (install → primo finding utile) | < 30 min | UX onboarding telemetry |
| **Bug-level replay success rate** | ≥ 95% | replay verified findings |
| **Flake rate** | < 5% | scenari flaky / totale |
| **Adoption per stack** | 5+ stack diversi in beta | account analytics |
| **AQA Score median** | ≥ 60 | aggregato su install base |

### Operations

| Metrica | Target v1.0 |
|---|---|
| Mean time to detect (MTTD) per incident | < 5 min |
| Mean time to recover (MTTR) | < 1h |
| API uptime | ≥ 99.9% |
| Helm install success rate | ≥ 95% on documented platforms |
| Air-gap install success rate | ≥ 90% |

### Adozione

| Metrica | Target |
|---|---|
| Reference enterprise customers | ≥ 3 in v1.0 |
| Pack contributed dalla community | ≥ 10 in 6 mesi post v1.0 |
| Compliance attestations | SOC2 T1 al GA, T2 +12m |
| Pen test esterno | Annuale |

---

## 17. Anti-patterns da evitare esplicitamente

Lista degli errori specifici da non commettere, ciascuno con il "perché":

1. **"AI che testa tutto in autonomia"** — promessa che il prodotto non può mantenere. Posizionamento corretto: framework per agenti, non agente autonomo.
2. **LLM-as-judge come unico oracle** — non deterministico, non calibrato, non accettabile per release-gate.
3. **Replay che non distingue bug/scenario/agent level** — induce false sicurezze, audit fail.
4. **Pack community senza signing** — il primo malicious pack che esfiltra `.env` chiude il progetto.
5. **AI-generation con auto-apply** — fa diventare il repo immagazzinatore di drift incontrollato.
6. **Bun-only** — esclude metà del mercato enterprise.
7. **SQLite per cloud/multi-runner** — corruzione e lock = downtime.
8. **`events.jsonl` come bus per scala** — non scala oltre singolo nodo.
9. **`destructive: false` come sandbox** — falsa sicurezza, security review fail.
10. **Cost governance "future"** — un singolo bug LLM-loop brucia il budget mensile.
11. **Observability "future"** — incidenti non triagabili, SLA non onorabili.
12. **Audit log mutabile** — compliance fail al primo audit.
13. **Schema non versionato** — breaking change inevitabili = adopter abbandona.
14. **Mancanza di SDK Python** — molti repo target sono Python; bloccare a TS è scelta povera.
15. **Marketplace prima di review obbligatoria** — diventa vettore di malware.
16. **Generate-with-AI senza provenance** — dopo 6 mesi nessuno sa quale prompt ha generato cosa, audit fail.
17. **Wizard che sovrascrive senza diff** — perdita di customizzazioni utente, perdita di fiducia.
18. **Trattare Copilot/Gemini come cittadini di seconda classe** — il "agent-compatible" è il moat, non Claude-only.
19. **Mancanza di DR/backup** — la prima corruzione = perdita di tutta la storia QA.
20. **Esecutive ambiguity agent vs orchestrator** — security review impossibile, capacity planning impossibile.

---

## 18. Verifica end-to-end del plan

Questa è un'analisi (artefatto documento), non codice. La "verification" consiste in:

### 18.1 Review interno

- [ ] Confrontare ogni falla F01..F12 con l'analisi originale `analisi-iniziale.md` per confermare che è davvero un gap (non un fraintendimento)
- [ ] Validare gli ADR proposti con un esperto di sicurezza esterno
- [ ] Validare il threat model con un Pen Tester
- [ ] Validare la compliance matrix con un consulente SOC2/ISO

### 18.2 Sanity check tecnico

Prima del primo commit, verificare con POC che le scelte chiave funzionino:
- [ ] Container-per-scenario isolation con teardown in < 5s overhead
- [ ] Postgres LISTEN/NOTIFY bus regge 1000 event/s su laptop dev
- [ ] OTel trace propagation attraverso boundary (runner → server → DB)
- [ ] Pack signing + verification con cosign keyless
- [ ] On-prem LLM (vLLM con un modello 7B) chiamabile come adapter

### 18.3 Validazione di mercato

- [ ] Interviste a 3-5 QA Lead enterprise (banche, telco, healthcare) su:
  - "Compreresti questo strumento?"
  - "Cosa ti bloccherebbe dall'installarlo?"
  - "Qual è il tuo budget annuo per QA tooling?"
  - "Quali altri tool usi e come si integra?"
- [ ] Validare la roadmap v0.1..v1.0 con CTO/CISO target

### 18.4 Validazione open source

- [ ] Posting su HN/Reddit/dev.to del posizionamento, raccogliere feedback
- [ ] PR template + CONTRIBUTING.md draft
- [ ] Confronto con progetti adiacenti (PromptFoo, Inspect, Mastra, AI Eval frameworks) per evitare reinvenzione

### 18.5 Documentazione minima per primo release

Prima di v0.1 GA serve:
- [ ] Architecture overview diagram
- [ ] Security whitepaper draft
- [ ] Threat model documento
- [ ] Getting started < 15 minuti
- [ ] CONTRIBUTING + Code of Conduct
- [ ] Licenza Apache-2.0 confermata + CLA opzionale
- [ ] Sample 2 esempi end-to-end completi (bun-api + nextjs-saas)

---

## Critical files / artefatti da produrre prima di scrivere codice

| Artefatto | Path proposto | Owner | Priorità |
|---|---|---|---|
| ADR-001 Execution mode | `docs/adr/001-execution-mode.md` | Architect | Blocker |
| ADR-002 Oracle chain | `docs/adr/002-oracle-chain.md` | Architect | Blocker |
| ADR-009 Determinism contract | `docs/adr/009-determinism-contract.md` | Architect | Blocker |
| ADR-007 Pack supply chain | `docs/adr/007-pack-supply-chain.md` | Security | Blocker |
| Schema JSON v1 | `schemas/v1/*.json` | Architect | Blocker |
| Threat model | `docs/security/threat-model.md` | Security | Pre v0.1 |
| Reference architecture | `docs/architecture/reference.md` | Architect | Pre v0.1 |
| Compliance matrix | `docs/compliance/matrix.md` | Compliance | Pre v0.3 |
| Sizing guide | `docs/operations/sizing.md` | SRE | Pre v0.3 |
| Helm chart values reference | `deploy/helm/values-reference.yaml` | SRE | Pre v0.3 |
| Backup/restore runbook | `docs/operations/dr-runbook.md` | SRE | Pre v0.3 |
| OpenAPI v1 | `schemas/v1/openapi.yaml` | API designer | Pre v0.4 |
| AsyncAPI v1 | `schemas/v1/asyncapi.yaml` | API designer | Pre v0.4 |

---

---

# PARTE II — IMPLEMENTATION PLAN ESEGUIBILE

> Da qui in poi il documento smette di essere analisi e diventa **playbook operativo**. Ogni macro-task ha branch dedicato, ogni sottotask ha PR verso il branch macro, ogni PR passa per il loop di validazione descritto sotto.

## 19. Stato iniziale & ground truth

- **Repo esistente:** `C:\Users\lopad\Documents\DocLore\Visual Basic\Ai\agentic-qa-kit`
- **Contenuto attuale:** solo `LICENSE` (Apache 2.0) + `README.md` stub di 109 byte. Git inizializzato con singolo commit `Initial commit` (c25dd4e). Nessun package.json, nessun src, nessun workflow.
- **Reference per convenzioni:** `C:\Users\lopad\Documents\DocLore\Visual Basic\Ai\product_image_discovery_admin` (Laravel+React admin pattern già rodato, 6 macro task completati). **Da copiare e adattare**: AGENTS.md (operating rules + branch strategy + Copilot loop), docs/{PROGRESS.md, LESSON.md, RULES.md}, CI workflow shape, branch strategy `task/<macro-slug>`.
- **Adattamento stack:** il reference è Laravel/PHP+React; AQA Kit è Bun/TypeScript+React. Sostituzioni: PHPUnit → `bun:test`/Vitest; Herd PHP wrapper → bun direct; Composer → bun; resto identico (workflow, branch, PR loop, Copilot review, docs di processo).

## 20. Process governance — REGOLE NON NEGOZIABILI

Queste regole valgono per **ogni** macro-task, **ogni** sottotask, **ogni** PR. Vanno copiate testualmente in `AGENTS.md`, `.claude/CLAUDE.md`, `.agents/skills/aqa-process-loop/SKILL.md`.

### 20.1 Branch strategy

```
main                                 ← stabile, protected, deploy-ready
└── task/<macro-slug>                ← un branch per ogni macro-task (sez. 23)
    ├── task/<macro-slug>/<sub-slug> ← un branch per ogni sottotask
    └── ...
```

- **Apri il branch macro** all'inizio del macro-task, da `main` aggiornato.
- **Apri un sub-branch** per ogni sottotask, da branch macro corrente.
- **PR sottotask → branch macro**. Merge solo dopo loop di validazione completato.
- **PR macro → main** quando tutti i sottotask sono mergiati e tutti i test del macro-task passano end-to-end.

### 20.2 Loop di validazione PR (obbligatorio per ogni PR)

```
1. Tutti i test in locale verdi
   - bun test (unit + integration)
   - bun run lint
   - bun run typecheck
   - bun run build
   - se UI/UX: bunx playwright test --reporter=line
2. Aprire PR via gh
3. Assegnare Copilot come reviewer:
     gh pr edit <num> --add-reviewer copilot-pull-request-reviewer
   (se il flag non funziona, usare il GraphQL workaround documentato nel reference)
4. Attendere che parta la Copilot review (sync via `gh pr view <num> --json reviewRequests`)
5. Attendere CI verde (tutti i job)
6. Se tutti verdi + nessun Copilot comment bloccante → MERGE
7. Se rosso o ci sono commenti:
   a. Fix locale
   b. push
   c. gh pr review-rerequest (Copilot)
   d. attendere
   e. tornare al passo 6
8. SOLO quando tutto è verde si chiude il task e si passa al next
```

### 20.3 Definition of Done per task/sottotask

Un task **non è chiuso** finché tutti questi sono veri:

1. **Obiettivo dichiarato all'apertura del branch** (nel body della PR macro o nel `PROGRESS.md`)
2. **Implementazione completa** secondo i dettagli del macro-task
3. **Guardrails**:
   - Unit test (bun:test o Vitest) per ogni nuovo file di codice non banale, copertura ≥ 80% per il codice nuovo
   - Integration test per ogni cross-package boundary
   - **Se il task tocca UI/UX** (qualsiasi cosa visibile nell'admin panel): scenari Playwright per ogni interazione utente significativa (form submit, click, navigation, drag/drop)
   - Se solo codice/CLI: niente Playwright, solo unit+integration
4. **Documentazione**:
   - README del package aggiornato (badges, TOC, features, setup junior-friendly step-by-step)
   - `docs/LESSON.md` aggiornato con scoperte/decisioni non ovvie fatte durante il task
   - `docs/PROGRESS.md` aggiornato con stato corrente e prossimo step
   - Se decisioni architetturali: ADR scritto in `docs/adr/`
5. **CI verde** (tutti i job del workflow)
6. **Copilot review processato** (nessun blocker, comment risolti o esplicitamente rejected con motivazione)
7. **Merge** della PR

### 20.4 File di processo (sempre vivi)

| File | Scopo | Aggiornamento |
|---|---|---|
| `AGENTS.md` | Hard rules, branch strategy, Copilot loop, technology defaults | Solo cambi di processo |
| `CLAUDE.md` | Identica copia operativa per Claude Code | Solo cambi di processo |
| `.github/copilot-instructions.md` | Identica copia operativa per Copilot | Solo cambi di processo |
| `GEMINI.md` | Identica copia operativa per Gemini | Solo cambi di processo |
| `docs/RULES.md` | Regole UI/UX, technology defaults, code style | Quando nasce una nuova regola condivisa |
| `docs/PROGRESS.md` | Stato corrente: macro-task attivo, sottotask in corso, prossimo step | **Ogni cambio di sottotask** |
| `docs/LESSON.md` | Lezioni apprese, errori scoperti, fix non ovvi, gotcha | Quando impari qualcosa di non ovvio, **specialmente dopo Copilot review** |
| `docs/adr/` | Architecture Decision Records | Quando prendi una decisione architetturale |

### 20.5 Subagent context handoff

Quando spawn un subagent (parallel work) o quando si apre nuova sessione:

- **PASSARE SEMPRE** nel prompt iniziale: contenuto di `AGENTS.md` + ultimo blocco di `docs/PROGRESS.md` + estratti rilevanti di `docs/LESSON.md`
- Subagent deve sapere: regole hard, branch corrente, sottotask attivo, lezioni recenti
- Al ritorno, il subagent **scrive** scoperte rilevanti in `docs/LESSON.md` e aggiorna `docs/PROGRESS.md`

### 20.6 Self-resume protocol

Quando una sessione si interrompe e si riprende:

1. Leggere `docs/PROGRESS.md` (ultimo stato)
2. Leggere ultimi 5 blocchi di `docs/LESSON.md`
3. `git status` + `git log --oneline -10`
4. `gh pr list --state open` per vedere PR in flight
5. Riprendere dal sottotask in cui si era interrotti

---

## 21. Task 0 — BOOTSTRAP (process governance setup) — FA PRIMA DI CODICE

> **Questo è il primo task in assoluto.** Nessun codice di prodotto viene scritto prima di aver completato Task 0.

**Branch:** `task/bootstrap-governance`

### Sottotask 0.1 — Copiare e adattare struttura process docs dal reference

- Leggere `product_image_discovery_admin/AGENTS.md` integralmente
- Leggere `product_image_discovery_admin/docs/{RULES.md, PROGRESS.md, LESSON.md}` integralmente
- Leggere `product_image_discovery_admin/.github/workflows/ci.yml`
- Scrivere in `agentic-qa-kit/`:
  - `AGENTS.md` — adattato a Bun/TypeScript, branch strategy, Copilot loop, hard rules
  - `CLAUDE.md` — copia operativa per Claude Code (può essere `@import AGENTS.md` o duplicato)
  - `GEMINI.md` — copia operativa per Gemini CLI
  - `.github/copilot-instructions.md` — copia operativa per Copilot
  - `docs/RULES.md` — UI/UX rules adattate (Tailwind+shadcn, dense, radius ≤8px, inline SVG, accessible labels, no nesting), tech defaults (Bun, TS strict, Vitest, Playwright)
  - `docs/PROGRESS.md` — template iniziale con macro-task 0 in corso
  - `docs/LESSON.md` — template vuoto con sezione "How to use this file"
  - `docs/adr/README.md` — template ADR + indice
- Guardrails: nessun unit test necessario (sono docs), ma includere link validity check (script bash semplice)

### Sottotask 0.2 — Skills, agents.md format per AQA workflow

- Creare `.agents/skills/aqa-process-loop/SKILL.md` — skill che istruisce qualsiasi agente sulla procedura task/PR/Copilot loop
- Creare `.agents/skills/aqa-self-resume/SKILL.md` — skill per riprendere sessione interrotta
- Creare `.claude/skills/` copie operative
- Guardrails: validate frontmatter YAML, lint markdown

### Sottotask 0.3 — Repo scaffolding tecnico

- `package.json` root (Bun workspaces)
- `tsconfig.base.json` (strict, ES2024, NodeNext)
- `.editorconfig`, `.gitignore`, `.gitattributes`
- `biome.json` o `eslint.config.js` + `prettier.config.js`
- `bunfig.toml`
- `.nvmrc` (Node 22 LTS come fallback) + `.bun-version`
- Guardrails: `bun install` esegue senza errori, `bun run lint` su file vuoti passa

### Sottotask 0.4 — CI workflow + branch protection

- `.github/workflows/ci.yml`:
  - matrix: Bun latest + Node 22 LTS
  - jobs: install, typecheck, lint, test (unit), test (integration), build
  - upload coverage to Codecov (or local artifact)
  - upload playwright trace on failure
- `.github/workflows/copilot-review.yml`:
  - on PR opened/synchronize → request Copilot review automaticamente
  - GraphQL workaround se gh CLI non supporta nativamente
- `.github/CODEOWNERS` (owner principale Lorenzo)
- `.github/pull_request_template.md` — template con checklist DoD
- `.github/ISSUE_TEMPLATE/{bug.yml, feature.yml, security.yml}`
- Branch protection rules per `main`: require PR + 1 approval + status checks green + linear history
- Guardrails: workflow lint con `actionlint`

### Sottotask 0.5 — Admin panel template spec doc

- Creare `docs/design/admin-panel-template.md` (vedi sezione 22 per il contenuto dettagliato)
- Questo file consente a un designer/frontender di iniziare il template in parallelo mentre il backend va avanti
- Guardrails: nessun test, ma deve essere così dettagliato che un junior frontender lo capisce senza fare domande

### Sottotask 0.6 — README enterprise wow per repo principale

- README.md riscritto con:
  - **Badges**: license, build status, version, downloads, bun version, node version, "works with Claude/Codex/Gemini/Copilot", coverage, OpenSSF Scorecard (quando attivato)
  - **Hero section**: positioning + tagline + demo GIF placeholder
  - **TOC** auto-generato
  - **Features** spiegate (con sub-features rare/fighe: multi-agent adapter, deterministic replay, BYOK LLM, on-prem option, OWASP Top 10 Agentic built-in)
  - **What's special** sezione "perché non un altro test runner"
  - **Quick start** step-by-step per un junior dev assoluto (install Bun → install package → init → run smoke → vedere il primo finding)
  - **Architecture diagram** (ASCII o link a docs/architecture/)
  - **Documentation links**
  - **Contributing** + Code of Conduct link
  - **License** + sponsor (opzionale)
- Guardrails: markdown lint, no broken link (script check)

### Sottotask 0.7 — Tag iniziale + commit governance

- Commit + push con messaggio standard
- PR `task/bootstrap-governance → main` 
- Loop di validazione completo
- Merge
- Tag `v0.0.1-governance` + GitHub release con changelog
- Aggiornare `PROGRESS.md` con "Bootstrap completato, prossimo: Task 1 — Schemas"

---

## 22. Admin panel template — design specification (per Sottotask 0.5)

Contenuto **integrale** che deve finire in `docs/design/admin-panel-template.md`. Permette di costruire il template UI in parallelo.

### 22.1 Tech stack vincolato

- **Framework:** React 19
- **Build:** Vite 6
- **Lingua:** TypeScript strict
- **Styling:** Tailwind CSS 4 (no preprocessor)
- **Component primitives:** shadcn/ui (Radix-based) — copy in `src/components/ui/`
- **Icons:** Lucide React (e/o inline SVG per icone custom)
- **State server:** TanStack Query v5
- **State client:** Zustand (per piccoli store globali) + React Context locale
- **Routing:** TanStack Router (typed routes)
- **Forms:** React Hook Form + Zod
- **Charts:** Recharts (semplici) + visx/d3 solo per timeline avanzata
- **Tables:** TanStack Table v8
- **Date:** date-fns
- **Test:** Vitest + Testing Library
- **E2E:** Playwright
- **Lint:** Biome o ESLint+Prettier (allinearsi a quello scelto per il monorepo)

### 22.2 Design principles (copia operativa da product_image_discovery_admin/docs/RULES.md adattata)

- **Densità alta**: tabelle compatte (riga ≤ 36px), padding moderati
- **Niente nesting di card** (Card dentro Card vietato)
- **Radius ≤ 8px** uniforme
- **Palette**: neutrali (slate/zinc) + accent per stato (`emerald` success, `amber` warning, `rose` danger, `sky` info, `violet` for AI-generated)
- **Tipografia**: Inter (sans), JetBrains Mono (mono per ID/code)
- **Icons inline SVG** per icone custom; Lucide per il resto
- **Accessible labels** su tutto (aria-label dove l'icona è da sola)
- **No overflow** a desktop standard (1280px) e tablet landscape (1024px); zoom 125% supportato
- **Dark mode** obbligatorio fin dal giorno 1 (class strategy Tailwind)
- **Empty states** sempre disegnati (mai pagine bianche)
- **Loading skeletons** specifici (no spinner generici), `<Skeleton>` per ogni sezione

### 22.3 Layout & navigation

```
┌─────────────────────────────────────────────────────────────┐
│ TopBar (h-12): logo + org switcher + project switcher +     │
│                global search + notifications + user menu     │
├──────┬──────────────────────────────────────────────────────┤
│      │                                                      │
│ Side │  Main Content Area (overflow-y-auto)                 │
│ Nav  │                                                      │
│ (w-  │  ┌─ Breadcrumb ──────────────────────────────────┐   │
│ 60)  │  │ Org / Project / Section / Detail              │   │
│      │  └────────────────────────────────────────────────┘  │
│      │                                                      │
│      │  ┌─ Page Header ─────────────────────────────────┐   │
│      │  │ Title + Subtitle + Primary actions (right)   │   │
│      │  └────────────────────────────────────────────────┘  │
│      │                                                      │
│      │  ┌─ Page Body ───────────────────────────────────┐   │
│      │  │ (tabs / table / detail / split / drawer)      │   │
│      │  └────────────────────────────────────────────────┘  │
│      │                                                      │
└──────┴──────────────────────────────────────────────────────┘
```

Sidebar items (con icona + label, attiva ha bordo sinistro accent):
- Dashboard
- Runs
- Findings
- Risk Map
- Scenarios
- Packs
- Agents & Skills
- Release Gates
- Replay Center
- Runner Fleet
- Cost & Quotas
- Audit Log
- Settings (sotto-menu: Project, Org, Integrations, Users, Tokens)

### 22.4 Screen inventory (ogni schermata da disegnare)

| # | Screen | Path | Componenti principali |
|---|---|---|---|
| 1 | Login | `/login` | Form (email+password+SSO buttons), error banner, "forgot password" |
| 2 | Org Switcher | `/orgs` | Lista org con role badge |
| 3 | Project List | `/orgs/:org/projects` | Tabella + create button + filters |
| 4 | Dashboard | `/p/:proj/dashboard` | KPI cards (4-6), last run summary, top open findings, release gate status, runner status, cost widget |
| 5 | Runs List | `/p/:proj/runs` | Tabella (run, profile, status, duration, findings, cost, started_at), filtri, kebab actions |
| 6 | Run Detail | `/p/:proj/runs/:runId` | Header (status, profile, duration, cost, model), tabs: Overview / Timeline / Scenarios / Findings / Artifacts / Logs |
| 7 | Live Timeline | `/p/:proj/runs/:runId/timeline` | Stream eventi (SSE), filter per type/actor, virtual scroll, search |
| 8 | Findings Kanban | `/p/:proj/findings` | Colonne: New, Needs Verification, Verified, Rejected, Needs Regression, Closed. Card draggable. |
| 9 | Finding Detail | `/p/:proj/findings/:id` | Header (severity badge, status, confidence), tabs: Evidence / Replay / Suggested Regression / History |
| 10 | Risk Map Viewer | `/p/:proj/risk-map` | Tabella (id, area, severity, scenarios count, coverage, last checked, status), filtri |
| 11 | Risk Map Editor | `/p/:proj/risk-map/edit` | Form per risk area + nested arrays per invariants/probes/oracles, diff side-by-side prima di save |
| 12 | Scenario List | `/p/:proj/scenarios` | Tabella per pack, search, run-single button |
| 13 | Scenario Studio | `/p/:proj/scenarios/:id` | Editor YAML con schema validation live (Monaco editor), preview, "Generate with AI" button, "Run Once" |
| 14 | Packs | `/p/:proj/packs` | Cards installed + available, enable/disable, version, signing status |
| 15 | Agents & Skills | `/p/:proj/agents` | Tabs: Claude / Codex / Gemini / Copilot. Per ogni: skills, agents, prompts, install status |
| 16 | Prompt Lab | `/p/:proj/prompts/:id` | Editor split (current + draft), test box, diff, save as new version |
| 17 | Release Gate | `/p/:proj/release-gates` | Lista release-gate run + decisione (PASS/WARN/BLOCK), reasoning, approval workflow |
| 18 | Replay Center | `/p/:proj/replay/:findingId` | Visualizzazione replay artifact, "Run Replay" button, output stream live, compare expected/actual |
| 19 | Runner Fleet | `/p/:proj/runners` | Tabella runner online/offline, capabilities badges, heartbeat, last job, rotate token |
| 20 | Cost & Quotas | `/p/:proj/cost` | Charts (cost over time, by model, by project), budget bars, alerts |
| 21 | Audit Log | `/p/:proj/audit` | Tabella audit con search, export, "verify hash chain" button |
| 22 | Settings — Project | `/p/:proj/settings` | Form generali, integrations, secrets |
| 23 | Settings — Org | `/orgs/:org/settings` | Users, roles, billing, SSO config |
| 24 | Settings — Integrations | `/p/:proj/settings/integrations` | Slack, Jira, GitHub, webhook |
| 25 | Empty Project Onboarding | `/p/:proj/onboarding` | Wizard 4 step (detect stack → choose packs → choose agents → first run) |

### 22.5 Component library spec

Componenti riusabili da creare in `src/components/`:

- `<PageHeader title subtitle actions />`
- `<KPICard label value delta icon trend />`
- `<DataTable columns data filters pagination />`
- `<StatusBadge severity />` (P0/P1/P2/P3 + color)
- `<ConfidenceBar value />` (0-1 + color gradient)
- `<RunStatusPill status />` (pending/running/passed/failed/cancelled/error)
- `<TimelineEvent event />` (per stream live)
- `<KanbanBoard columns items onMove />`
- `<DiffViewer before after lang />` (per prompt/skill/scenario diff)
- `<CodeEditor language value onChange schema />` (Monaco wrapper)
- `<ArtifactViewer artifact />` (auto switch su file type)
- `<SkeletonTable rows cols />`
- `<EmptyState icon title description action />`
- `<ConfirmDialog title description danger onConfirm />`

### 22.6 Wireframe textuali per le 5 schermate più importanti

#### Dashboard (`/p/:proj/dashboard`)

```
┌─ PageHeader ────────────────────────────────────────────┐
│ Dashboard — crm-backend         [Run smoke] [Run release]│
└──────────────────────────────────────────────────────────┘

┌─ KPI Row ───────────────────────────────────────────────┐
│ [Open findings: 12 (+3)] [P0/P1: 2] [Cost MTD: $234]    │
│ [Run last 7d: 89] [Avg duration: 4m12s] [AQA Score: 74] │
└──────────────────────────────────────────────────────────┘

┌─ 2-col grid ────────────────────────────────────────────┐
│ ┌─ Release Gate ────────┐  ┌─ Top Open Findings ─────┐  │
│ │ BLOCK                 │  │ P0 cross-tenant access  │  │
│ │ 1 P0 verified         │  │ P1 idempotency...       │  │
│ │ 2 P1 not triaged      │  │ ...                     │  │
│ └────────────────────────┘  └─────────────────────────┘  │
│                                                          │
│ ┌─ Cost trend ──────────┐  ┌─ Runner Fleet ──────────┐  │
│ │ chart                 │  │ 3 online, 1 offline     │  │
│ └────────────────────────┘  └─────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

(I wireframe per Runs, Findings, Risk Map, Live Timeline vanno specificati nel file `docs/design/admin-panel-template.md` con lo stesso livello di dettaglio.)

### 22.7 Empty/error/loading states

Per ogni schermata definire esplicitamente:
- **Empty state**: cosa mostrare se 0 record
- **Loading state**: Skeleton specifico (non spinner)
- **Error state**: messaggio + retry + link a debug
- **Permission denied**: messaggio + chi contattare

### 22.8 Playwright scenarios da pre-pianificare (per copertura UI)

Almeno uno scenario per:
- Login flow (happy + invalid creds)
- Project switch
- Dashboard load + KPI render
- Run list → Run detail navigation
- Findings Kanban drag-and-drop
- Finding verification action
- Risk Map view + edit + save with diff confirmation
- Scenario Studio: load, edit YAML, validate, save
- Replay run with live output
- Cost dashboard date-range filter

---

## 23. Macro tasks v0.1 — dettaglio esecutivo

Tutti i macro task sotto sono successivi a Task 0. Ognuno apre il branch `task/<slug>`.

### Task 1 — `task/schemas-and-core-types` (~2 settimane)

**Obiettivo:** package `agentic-qa-kit-schemas` zero-deps, source of truth per tutti i tipi.

| # | Sottotask | Deliverable | Guardrails |
|---|---|---|---|
| 1.1 | JSON Schema v1 | `packages/schemas/v1/{risk-map,scenario,finding,event,run,pack-manifest,profile,project}.schema.json` | Tutti gli schema validano contro JSON Schema 2020-12 meta-schema |
| 1.2 | TypeScript types generati | `packages/schemas/src/types.ts` con codegen `json-schema-to-typescript` | `bun run typecheck` zero errori |
| 1.3 | Zod runtime validators | `packages/schemas/src/validators.ts` (per validazione runtime) | Unit test: round-trip JSON→parse→stringify |
| 1.4 | Fixtures di esempio | `packages/schemas/fixtures/` con esempi validi e invalidi | Test: validi passano, invalidi falliscono con error path corretto |
| 1.5 | README package | Badges + TOC + features + setup junior + usage examples | Markdown lint + link check |

### Task 2 — `task/cli-foundation` (~2 settimane)

**Obiettivo:** CLI `aqa` con comandi `init`, `doctor`, `validate`.

| # | Sottotask | Deliverable | Guardrails |
|---|---|---|---|
| 2.1 | CLI scaffold | `packages/kit/src/cli/` con `cleye` o `commander`, `bin/aqa.ts` | `bunx aqa --version` funziona |
| 2.2 | Project profiler | Detect Bun/Node, framework, DB, LLM presence, test runner | Unit test su 5 fixture repos (mock) |
| 2.3 | `aqa init` | Crea `.aqa/{project.yaml, testing.md, risk-map.yaml, profiles.yaml}` | Integration test su tmpdir |
| 2.4 | `aqa doctor` | Output checklist con ⚠/✓, suggested next steps | Snapshot test del output |
| 2.5 | `aqa validate` | Valida tutto l'ecosistema `.aqa` con error path precisi | Test su `.aqa` con errori intenzionali |
| 2.6 | README kit | Setup junior step-by-step (install Bun → install kit → init → doctor → validate) | Link check |

### Task 3 — `task/pack-system-and-base-packs` (~3 settimane)

**Obiettivo:** sistema pack + 5 pack base (`core`, `api`, `web-ui`, `llm-agent`, `security`).

| # | Sottotask | Deliverable | Guardrails |
|---|---|---|---|
| 3.1 | Pack loader + manifest schema | `packages/kit/src/packs/loader.ts` con `applies_when` evaluation | Unit test su 10 manifest |
| 3.2 | Template engine | `eta` o `njk`, render con `project.yaml` + risk context | Unit test render output deterministico |
| 3.3 | `@aqa/pack-core` | testing.md, risk-map base, profiles, bug-verification runbook | Generates valid artifacts per fixture project |
| 3.4 | `@aqa/pack-api` | Scenari auth, idempotency, pagination, rate limit, contract | Test: applies_when fires per fixture FastAPI |
| 3.5 | `@aqa/pack-web-ui` | Scenari login, form, navigation, refresh | Test: applies_when fires per fixture Next.js |
| 3.6 | `@aqa/pack-llm-agent` | Eval tool selection, prompt injection, handoff | Test su fixture LLM agent app |
| 3.7 | `@aqa/pack-security` | OWASP Top 10 + OWASP Agentic Top 10 | Coverage scenari ≥ 20 |
| 3.8 | `aqa generate --packs ...` | Genera tutto, draft mode, no overwrite | Test: idempotent + diff display |
| 3.9 | README per ogni pack | Badge + features + esempio scenari generati | Link check |

### Task 4 — `task/multi-agent-adapters` (~2-3 settimane)

**Obiettivo:** adapter Claude, Codex, Gemini, Copilot + `aqa install-agent-files`.

| # | Sottotask | Deliverable | Guardrails |
|---|---|---|---|
| 4.1 | Adapter abstraction | Interface + capability profile YAML | Unit test su capability negotiation |
| 4.2 | Claude adapter | Genera CLAUDE.md, .claude/skills/*, .claude/agents/* | Snapshot test su output |
| 4.3 | Codex adapter | Genera AGENTS.md, .agents/skills/*, plugin manifest | Snapshot test |
| 4.4 | Gemini adapter | Genera GEMINI.md, .gemini/{skills,agents,commands} | Snapshot test |
| 4.5 | Copilot adapter | Genera .github/{copilot-instructions.md, skills, agents, hooks} | Snapshot test |
| 4.6 | `aqa install-agent-files --targets ...` | Wizard interattivo + flag non-interactive | Integration test |
| 4.7 | Capability matrix doc | `docs/capability-matrix.md` | Manual review |
| 4.8 | README adapters | Quale agente vede cosa, esempi | Link check |

### Task 5 — `task/runner-and-run-lifecycle` (~3 settimane)

**Obiettivo:** `aqa run --profile smoke` end-to-end con events.jsonl + findings.jsonl.

| # | Sottotask | Deliverable | Guardrails |
|---|---|---|---|
| 5.1 | Run lifecycle state machine | `packages/kit/src/runner/lifecycle.ts` | Unit test su tutte le transizioni |
| 5.2 | Events writer (jsonl + bus) | Append-only, schema-validated | Unit test su throughput 1k evt/s |
| 5.3 | Findings writer | Schema-validated, dedup base | Unit test su dedup |
| 5.4 | Sandbox abstraction v0.1 | Process isolation, timeout, tool-call budget | Unit test su violazione budget |
| 5.5 | Oracle registry + 5 oracle | http_status, response_contains, response_not_contains, json_schema, db_query | Unit test per ogni oracle |
| 5.6 | Probe registry + 5 probe | invalid_payload, stale_token, copied_id, double_click, prompt_injection | Unit test per ogni probe |
| 5.7 | `aqa run --profile smoke` | End-to-end su fixture app | E2E test: trovare un bug noto inserito di proposito |
| 5.8 | Run artifacts | `.aqa/runs/<id>/{run.json, events.jsonl, findings.jsonl, artifacts/, logs/}` | Schema check post-run |

### Task 6 — `task/reports-and-replay` (~2 settimane)

**Obiettivo:** report markdown/html/json + replay end-to-end.

| # | Sottotask | Deliverable | Guardrails |
|---|---|---|---|
| 6.1 | Markdown reporter | `aqa report --format md` | Snapshot |
| 6.2 | HTML reporter | Standalone HTML con stili inline | Lighthouse check |
| 6.3 | JSON reporter | Schema-validated | Schema check |
| 6.4 | Replay artifact generation | repro.sh, repro.curl, repro.playwright.ts | Test esegue replay e replica bug |
| 6.5 | `aqa replay <finding-id>` | Esegue replay e aggiorna stato | Integration test |
| 6.6 | `aqa verify <finding-id>` | Riprova 3x, classifica deterministico | Unit + integration |

### Task 7 — `task/admin-panel-bootstrap` (~3 settimane)

**Obiettivo:** scaffold del package admin (NO backend, solo viewer locale che legge `.aqa/`).

| # | Sottotask | Deliverable | Guardrails |
|---|---|---|---|
| 7.1 | Vite + React 19 + TS strict scaffold | `packages/admin/` | `bun run dev` parte |
| 7.2 | Tailwind 4 + shadcn/ui setup | Theme dark/light | Playwright smoke |
| 7.3 | TanStack Router + sidebar layout | Tutte le 25 rotte stub | Playwright nav smoke |
| 7.4 | Local file reader API (Bun server stub) | Legge `.aqa/runs/*` | Unit + integration |
| 7.5 | Dashboard screen | KPI + last run + top findings | Playwright: render + interaction |
| 7.6 | Runs list + detail | Tabella + tabs | Playwright |
| 7.7 | Findings Kanban | Drag-and-drop | Playwright |
| 7.8 | Risk Map viewer (read-only) | Tabella | Playwright |
| 7.9 | Replay viewer | Output stream | Playwright |
| 7.10 | README admin | Setup junior step-by-step | Link check |

### Task 8 — `task/documentation-and-release-v0.1` (~1-2 settimane)

**Obiettivo:** documentazione enterprise + release v0.1.0.

| # | Sottotask | Deliverable | Guardrails |
|---|---|---|---|
| 8.1 | README enterprise wow finale | Riscrittura completa con badges/TOC/features/quick-start junior | Markdown lint, link check |
| 8.2 | `docs/getting-started.md` | 15-min onboarding | Manual review |
| 8.3 | `docs/architecture/reference.md` | Diagram + componenti | Manual |
| 8.4 | `docs/security/overview.md` + threat-model.md | Threat model sintetico | Manual |
| 8.5 | `docs/methodology/agentic-qa.md` | Methodology + Risk/Invariant/Probe/Oracle | Manual |
| 8.6 | `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md` | Standard OSS | Manual |
| 8.7 | Examples: `examples/bun-api/`, `examples/nextjs-saas/` | Demo end-to-end con `.aqa` generato | Build + run smoke verde |
| 8.8 | ADR 001-009 (i critici) | `docs/adr/` | Manual review |
| 8.9 | CHANGELOG.md + tag v0.1.0 + GitHub release | Release con artefatti | gh release create |

### Task 9 (FINAL) — `task/knowledge-consolidation` (~1 settimana)

**Obiettivo:** consolidare lezioni apprese in rules/skills/agents.md.

| # | Sottotask | Deliverable | Guardrails |
|---|---|---|---|
| 9.1 | Review `docs/LESSON.md` completo | Estrarre pattern ricorrenti, errori frequenti, gotcha | Manual |
| 9.2 | Update `AGENTS.md` / `CLAUDE.md` / `GEMINI.md` / `copilot-instructions.md` | Aggiungere regole derivate dalle lezioni | Diff review |
| 9.3 | Update `docs/RULES.md` | Nuove regole UI/UX/code style scoperte | Diff review |
| 9.4 | Create/enhance `.agents/skills/aqa-*` | Skill nuove emerse dal lavoro fatto | Frontmatter validate |
| 9.5 | Tag v0.1.1 con changelog "process improvements" | gh release | Manual |

---

## 24. Roadmap macro task post v0.1

| Macro task | Branch | Target version |
|---|---|---|
| Task 10 — Determinism contract + 3-level replay | `task/determinism-contract` | v0.2 |
| Task 11 — Cost governance hard | `task/cost-governance` | v0.2 |
| Task 12 — Container sandbox default | `task/sandbox-container` | v0.2 |
| Task 13 — Postgres backend + storage abstraction | `task/postgres-backend` | v0.3 |
| Task 14 — SSO/OIDC + RBAC | `task/sso-rbac` | v0.3 |
| Task 15 — Pack signing + scanning | `task/pack-signing` | v0.3 |
| Task 16 — On-prem LLM adapters (vLLM, Bedrock private) | `task/on-prem-llm` | v0.3 |
| Task 17 — Admin editing (Scenario Studio, Risk Editor) | `task/admin-editing` | v0.4 |
| Task 18 — AI generation con review workflow | `task/ai-generation` | v0.4 |
| Task 19 — Server multi-team + runner fleet | `task/multi-team-server` | v0.5 |
| Task 20 — Findings dedup + clustering | `task/findings-clustering` | v0.5 |
| Task 21 — Methodology: STRIDE/FMEA/OWASP integration | `task/methodology-frameworks` | v0.6 |
| Task 22 — Helm chart + Terraform module + air-gap installer | `task/deploy-self-hosted` | v0.6 |
| Task 23 — SOC2/ISO readiness + pen test | `task/compliance-soc2` | v1.0 |

---

## 25. Auto-mode execution protocol

Quando l'utente dice "vai in auto mode e procedi":

1. Verificare di **non** essere in plan mode (se sì, ExitPlanMode prima)
2. Aprire `docs/PROGRESS.md`, se esiste, e leggere stato corrente
3. Se PROGRESS non esiste → siamo all'inizio → eseguire Task 0
4. Per ogni macro-task in ordine:
   a. Aprire branch macro
   b. Per ogni sottotask:
      - Aggiornare PROGRESS.md (sottotask in corso)
      - Implementare
      - Eseguire guardrails locali (test, lint, typecheck, build)
      - Aprire PR sub → macro
      - Assegnare Copilot reviewer
      - Loop validazione (sez. 20.2)
      - Merge
      - Aggiornare LESSON.md se scoperte
   c. Aprire PR macro → main
   d. Loop validazione
   e. Merge
   f. Tag intermedio se previsto
5. Task 9 finale obbligatorio
6. Tag v0.1.0 + GitHub release

---

## 26. Verifica end-to-end del plan completo

- [ ] Plan salvato in `C:\Users\lopad\.claude\plans\` (questo file)
- [ ] Copia umana-leggibile in `agentic-qa-kit/docs/implementation-plan.md` (Sottotask 0.1)
- [ ] AGENTS.md/CLAUDE.md/GEMINI.md/copilot-instructions.md contengono **regole sez. 20** verbatim
- [ ] CI workflow ha gate: test, lint, typecheck, build, playwright (se UI)
- [ ] Branch protection main attivo
- [ ] Copilot review automation funziona (testato su PR Task 0)
- [ ] PROGRESS.md tracking attivo
- [ ] LESSON.md aggiornato ad ogni Copilot iteration
- [ ] Tag v0.1.0 release pubblicata con changelog completo

---

## Riepilogo "se hai 30 secondi"

Il design originale è promettente come visione community. Per essere enterprise self-hosted production-ready mancano 12 cose critiche, di cui 5 sono **blocker** assoluti:

1. **Disambiguare** chi esegue (agente vs orchestrator) — ADR-001
2. **Replay deterministico a livello bug** obbligatorio per `verified` — ADR-009
3. **Cost governance** con kill-switch — ADR-008
4. **Sandbox reale** (container, fs caps, egress) — ADR-006
5. **Pack signing + scanning** prima di marketplace — ADR-007

Aggiungendo observability nativa, schema versionato, storage abstraction, audit immutabile, SSO/RBAC, on-prem LLM, DR/backup, e ridimensionando la roadmap (foundations → table-stakes → admin → multi-team → methodology → GA), il prodotto diventa vendibile a banche, telco, healthcare, gov.

La frase di posizionamento può rimanere:

> AQA Kit is not a test runner. It is an agentic QA operating system for software projects.

Ma il sottotesto enterprise deve aggiungersi:

> Deterministic where it matters, observable by default, sandboxed by design, auditable end-to-end. Bring your own LLM, your own keys, your own perimeter.
