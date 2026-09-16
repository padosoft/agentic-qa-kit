# Agentic QA Kit — deep review tecnica e strategica

Data: 2026-09-17. Revisione: `044135cdee0aaaf2e865ca10381ef5e4052ed22e`, branch `main`, CLI dichiarata `1.9.0`.

Documento maintainer-internal. Valutazione del repository e di riproduzioni locali, non certificazione di sicurezza, compliance o disponibilità di un servizio distribuito. Le proposte non sono implementazioni già consegnate.

Estensione richiesta durante la review: [AQA Commerce Assurance — progettazione e-commerce](ecommerce-qa-design-2026-09-17.md), con gap del catalogo attuale, 24 aree funzionali, contratti di dominio, dieci journey prioritari e gate di delivery. È una proposta da approvare, non copertura già disponibile.

## 1. Verdetto

**Il progetto non è production-ready enterprise. Non lo userei oggi come unico release gate, sistema di audit attendibile o servizio condiviso tra tenant.**

L'idea resta buona: collegare rischio, invariante, scenario, azione, verifica, finding e riproduzione. Sono presenti componenti utili: schemi Zod, discovery dei pack, CLI modulare, scrittura di eventi concatenati, controlli sui percorsi e un insieme consistente di test. La distanza fra queste fondamenta e le promesse pubbliche è però ampia. La descrizione più accurata è **prototipo integrato con librerie funzionanti e superfici enterprise in parte dichiarative**.

Il problema maggiore non è l'assenza di una feature secondaria: è la possibilità di produrre evidenza apparentemente positiva senza avere verificato il comportamento richiesto. Questa review riproduce falsi verdi, una verifica audit simulata, perdita di finding e mancata persistenza.

| Dimensione | Giudizio motivato |
| --- | --- |
| Modello di prodotto | Valido; rischio e prove sono un buon punto di partenza |
| Correttezza del motore | Insufficiente per decisioni di rilascio: falsi verdi riprodotti |
| Sicurezza del servizio | Bloccante per uso condiviso: auth, tenant e controlli runtime incompleti |
| Integrità e persistenza | Bloccante: stato volatile, collisioni, audit UI non crittografico |
| Packaging e delivery | Regressione build; bundle `run`/`admin` non funzionante |
| Qualità dei test | Buona copertura di componenti; lacune decisive nei percorsi completi |
| Manutenibilità | Backend leggibile; admin monolitico di 14.099 righe escluso da typecheck effettivo e lint |
| Stato dell'arte agentico | Visione ancora pertinente; implementazione molto indietro rispetto alle capacità documentate del settore |

Non assegno percentuali di readiness: senza criteri di accettazione pesati sarebbero precisione apparente.

## 2. Metodo, perimetro e limiti

Mappati i 20 package, i cinque pack, entrypoint CLI, API/store, runner/oracoli/replay, auth/sandbox/costi, integrazioni agenti/LLM, admin, CI/pubblicazione e deployment. Consultati README, regole, progress, lesson, ADR, architettura, threat model e sezioni pertinenti del blueprint interno. L'analisi approfondita segue le catene di produzione e consumo dei dati; non è una dichiarazione di lettura manuale di ogni byte di ogni asset, fixture e pagina duplicata.

Usate le skill `engineering:code-review` e `engineering:testing-strategy`: finding con impatto e riferimenti, confronto fra test di componenti e prove dei percorsi reali. Applicata la preferenza complete-journey: frontend compilato → API reale → stato → riavvio/rilettura, dichiarando dove manca persistenza. Nessuna correzione al codice di prodotto, pubblicazione, PR o modifica remota.

Ambiente locale: Windows, PowerShell, Bun `1.3.14`, Node `25.2.1`. Node 22 e Linux **non rieseguiti localmente**. Il campo `process.version` di Bun non è la versione del binario Node: per questo le riproduzioni finali sono state eseguite esplicitamente con `node`.

Riproduzioni: [script diagnostico](reviews/2026-09-17-reproduce.mjs). Comandi, dal root:

```powershell
bun run build:workspace
node docs/internal/reviews/2026-09-17-reproduce.mjs
```

Lo script usa dati sintetici, directory temporanee e HTTP loopback. Non chiama provider LLM o sistemi esterni. Stampa osservazioni, **non è una suite di regressione verde**: alcune osservazioni attestano difetti. Mantiene le fixture temporanee per ispezione. La prova browser usa Chromium con il frontend Vite compilato e `runAdmin()` reale; zero richieste API intercettate. Un primo tentativo browser con Bun è rimasto bloccato ed è stato interrotto; l'esecuzione con Node è riuscita. Non attribuisco quel blocco al prodotto.

Non eseguiti: penetration test su installazioni remote, benchmark commerciale comparativo, suite completa Playwright, deploy Kubernetes, ripristino backup, carico distribuito, autenticazione con IdP reale, installazione del tarball dal registry, chiamate LLM live. Questi percorsi restano non verificati.

## 3. Che cosa fa davvero

| Superficie | Implementazione osservata | Limite essenziale |
| --- | --- | --- |
| `schemas` | Contratti Zod, fixture, JSON Schema generati | Contratti non applicati a tutte le mutazioni; configurazioni probe/oracle poco tipizzate |
| `kit` | init, doctor, validate, install-agent-files, run, report, admin, pack new | Bundle rotto in due verbi; validate controlla tre file, non l'intero grafo semantico |
| `pack-author`, `pack-loader` | Scaffold, parsing, discovery, filtri, protezioni traversal/symlink | Trust/signature non collegati alla discovery/esecuzione |
| `runner` | Sequenze di probe, tre oracoli built-in, HTTP reale se configurato, JSONL | Nessun driver reale per browser/SQL/LLM; stub implicito senza base URL |
| `reporter` | Report JSON/Markdown; generatore separato di replay | Generatore replay non chiamato da `aqa run`; template Playwright senza azioni |
| `adapters` | Render deterministico di istruzioni e skill per quattro host | Matrice statica, formato skill da correggere, nessuna negoziazione runtime |
| `llm-adapters` | Fixture registrate per hash | Tutti i provider live passano da scaffold che lancia errore |
| `generator` | Parse di proposte e coda di approvazione in memoria | Nessun percorso completo generazione live → approvazione persistita → esecuzione |
| `auth` | Matrice ruoli/permessi e predicato `allows` | OIDC non implementato; adapter HTTP locale non applica `requires` |
| `store` | `MemoryStore` esteso | Postgres non implementato; SQLite assente |
| `server` | Tabella di handler e coda FIFO in memoria | Non equivale a control plane distribuito con worker, auth e stato durevole |
| `sandbox` | Wrapper process con timeout; container scaffold | CLI non lo usa; timeout process non interrompe il lavoro sottostante |
| `cost` | Contatore di spesa e listino | Nessuna riserva atomica/kill-switch integrato; modello sconosciuto costa zero |
| `admin`, `admin-core` | SPA con numerose interazioni; utility optimistic state | Runs/Findings ancora su fixture; utility di conflitto non applicata alle scritture API |
| `clustering` | Raggruppamento per signature testuale | Non è root-cause analysis; normalizzazione elimina numeri significativi |
| `methodology` | Mapping STRIDE, FMEA e tag OWASP | Non misura copertura verificata né efficacia dei test |
| `compliance` | Catalogo controlli e verifica hash server-side | Non produce certificazione; manca ancoraggio indipendente dell'audit |
| Deployment | Template Helm, namespace Terraform, script bundle air-gap | Nessuna prova operativa enterprise; componenti applicativi sottostanti incompleti |

Un punto positivo importante: alcuni scaffold falliscono esplicitamente anziché fingere di operare. Il problema nasce quando README e composizione del prodotto aggirano o contraddicono quei limiti.

## 4. Risultati dei controlli

| Controllo | Esito e interpretazione |
| --- | --- |
| `bun run build` | PASS, ma genera 23 pagine del sito documentale: non compila il prodotto |
| `bun run build:workspace` | PASS; warning esbuild sulla perdita di `import.meta` nel CJS; warning bundle admin >500 kB |
| `bun run typecheck` dopo build workspace | PASS; non valida il corpo di `app.tsx` coperto da `@ts-nocheck` |
| `bun run lint` | FAIL; diagnostica sui file del sito documentale, compreso formatting |
| `bun test` | 366 PASS, 2 FAIL, 368 totali / 36 file |
| Analisi dei due FAIL | Creazione symlink non disponibile e chiamata `node:test` `t.skip()` non implementata da Bun; problema del percorso di skip della fixture, non prova di traversal riuscito |
| `bun run test:e2e-cli` | 5/5 PASS; usa `dist/cli/aqa.js`, non il bundle pubblicato `dist/cli.cjs` |
| Script diagnostico Node | Riproduzioni sotto riportate, inclusa prova browser con backend reale |
| GitHub CI di HEAD | FAILURE: job Typecheck + Lint fallisce al lint, build/test/E2E successivi skipped |
| `bun audit --json` | Exit 1; 17 record advisory su 8 package, inclusi 12 high, 4 moderate, 1 low |
| `npm --prefix docs-site audit --json` | Metadata: 6 dipendenze vulnerabili, 5 high e 1 moderate; fix disponibili secondo il registry |

CI esaminata: [run 27881325266](https://github.com/padosoft/agentic-qa-kit/actions/runs/27881325266), sulla revisione esatta analizzata. Anche i due precedenti run CI restituiti per `main` risultano falliti.

Gli advisory non sono automaticamente vulnerabilità sfruttabili del servizio: occorre distinguere build/dev/runtime e reachability. Root: Babel, baseline-browser-mapping, browserslist, esbuild, fast-uri, nanoid, PostCSS, Vite. Docs: transformers, adm-zip, linkify-it, onnxruntime-node, protobufjs, sharp. Gli advisory transitivi npm e i record Bun non sono unità equivalenti e non vanno sommati come un unico conteggio di exploit.

## 5. Finding prioritizzati

Severità: **P0** blocca l'uso come sistema attendibile di QA o l'esposizione nel modello indicato; **P1** impedisce un flusso essenziale o una promessa enterprise; **P2** debito significativo. La priorità non è un punteggio CVSS. R = riprodotto; S = evidenza statica; D = limite progettuale.

### F01 — P0/R — Release gate verde senza eseguire il SUT

Riferimenti: `packages/runner/src/run.ts:27,93`; `packages/kit/src/commands/run.ts:452,520`.

Quando `sut.base_url` manca, `runScenario` usa `NO_NETWORK_PROBE`: restituisce HTTP 200 e body null per qualunque probe. Uno scenario expected-200 passa senza traffico; lo script produce `release-gate-no-network: {ok:true, findings:0, scenarios:1}`. Anche il pack LLM prompt-injection passa su una risposta mai generata da un LLM.

**Intervento:** preflight obbligatorio su capability, target e configurazione; driver fixture esplicito e non ammesso nei gate di produzione; stati `PASS/FAIL/ERROR/BLOCKED/NOT_RUN`, nessun default-success. **Accettazione:** rimuovere target o driver deve impedire il PASS prima delle azioni, con gap esplicito nell'evidenza.

### F02 — P0/R — Idempotenza e token rotation producono falsi verdi

Riferimenti: `packs/api-core/scenarios/idempotency.yaml`; `auth-token-replay.yaml`; `packages/runner/src/oracles.ts:39`; `run.ts:43`.

Lo scenario idempotenza usa `jsonpath` e `equals`; `response_contains` legge solamente `with.value`, assente, quindi cerca la stringa vuota. Riproduzione: risposte `{id:1}` e `{id:2}` → oracle PASS e nessun finding.

Lo scenario token usa `with.auth: ${OLD_TOKEN}`, non letto dal driver HTTP. Il server loopback riceve due richieste senza Authorization, risponde 401 a `/me`, e il controllo PASSA. Non sono stati provati né validità precedente del token né revoca entro 60 secondi.

**Intervento:** schemi discriminati per tipo, parametri sconosciuti rifiutati, riferimenti tipizzati alle uscite degli step; sessioni/token gestiti da secret reference; baseline positiva prima della rotazione. **Accettazione:** SUT che crea duplicati e SUT che mantiene valido il vecchio token devono fallire; SUT corretti devono passare.

### F03 — P0/R — Errori di esecuzione scambiati per assenza di vulnerabilità

Riferimenti: `packages/runner/src/oracles.ts:51`; `run.ts:40,110`.

`response_not_contains` valuta body mancanti come stringhe vuote. Un probe che restituisce errore di rete passa una verifica di assenza di dato proibito. Vale anche per tipi unsupported restituiti come `error` dal driver HTTP. L'errore non prevale sul risultato dell'oracolo.

**Intervento:** execution status separato dall'assertion status; gli oracoli operano solo su osservazioni valide; errori di infrastruttura non diventano bug del SUT né prove di sicurezza. **Accettazione:** target down, timeout, driver assente e permessi insufficienti non possono generare PASS.

### F04 — P0/R — Il browser dichiara integra una catena alterata

Riferimenti: `packages/admin/src/app.tsx:3496,3847,11210`; `packages/admin/test/e2e/audit-chain.e2e.ts`.

`validateChainStep` controlla continuità di `prev_hash` e un flag sintetico `payload.tampered`; non ricalcola SHA-256. Il primo evento non è controllato dal loop. La normalizzazione scarta inoltre campi necessari a ricostruire il digest originale.

**Prova completa:** evento scritto dal writer reale, serializzato, payload cambiato senza rehash, caricato dall'admin reale, frontend compilato in Chromium → **CHAIN OK**. Il verificatore backend sullo stesso dato restituisce `ok:false`. Zero mocking di richieste. Il test esistente denominato live usa hash inventati `aaa…/bbb…` e `page.route`.

**Intervento:** verificatore condiviso browser-safe sul record completo; raggruppamento per run e ordinamento per `seq`; distinzione fra catena completa e pagina filtrata. **Accettazione:** alterazioni di primo/ultimo evento e payload, record rimossi/riordinati, hash arbitrari e più run indipendenti devono avere esiti corretti.

### F05 — P0/R — Accesso amministrativo senza autenticazione

Riferimenti: `packages/kit/src/commands/admin.ts:125,369,442`; `packages/server/src/api.ts:978`.

L'admin crea sempre `usr-local` con ruolo admin. L'adapter HTTP non applica `route.requires`; espone CORS `*`. Una richiesta senza credenziali con Origin estraneo crea un'organizzazione con HTTP 201. La route runner dequeue ha `requires:null` e nessuna protezione fleet nel wrapper.

Il bind predefinito loopback riduce l'esposizione di rete; **non è autenticazione**. L'opzione LAN espone una superficie amministrativa senza controllo d'accesso. Non è stata condotta una catena di attacco da sito Internet: restrizioni browser/PNA possono incidere e non sono considerate provate da un header Origin inviato via fetch server-side.

**Intervento:** middleware deny-by-default, sessione locale protetta, verifica Origin/Host, CORS allowlist, auth obbligatoria per bind non-loopback, credenziale runner distinta. **Accettazione:** HTTP reale con anonymous/viewer/developer/admin/runner, metodo per metodo, senza effetti collaterali delle richieste negate.

### F06 — P0/R+S — Tenant scope non è autorizzazione

Riferimenti: `packages/server/src/api.ts:76,229,258`; `packages/store/src/memory.ts:83,119,185`.

Il client sceglie org/project negli header, ma manca il collegamento a membership verificata. La lista finding ignora completamente il tenant; alcune letture run filtrano solo project. Lo store dei rischi ignora org/project; l'audit lascia passare eventi privi di tag tenant.

Riproduzione handler/store: una richiesta con progetto estraneo riceve un finding HTTP 200. È una prova del contratto API attuale, non di una distribuzione SaaS già protetta da middleware esterno.

**Intervento:** `TenantContext` derivato dall'identità, chiavi composte e scope obbligatorio in ogni metodo store; opzionale RLS come difesa aggiuntiva; nessun fallback globale per dati non taggati. **Accettazione:** matrice A/B con stessi slug e ID, letture e scritture, queue, replay, audit, notifiche, token e ricerche.

### F07 — P1/R — Finding di run diversi si sovrascrivono

Riferimenti: `packages/runner/src/run.ts:124`; `packages/kit/src/commands/run.ts:526`; `packages/store/src/memory.ts:119`.

Il seed dei finding riparte da 1 per ogni run. L'ID `AQA-2026-0001` viene riutilizzato; `MemoryStore` indicizza solo per finding.id. Due run con finding distinti diventano un solo record. I JSONL separati mantengono i record, ma la proiezione aggregata perde uno dei due.

**Intervento:** identificatore interno globalmente univoco e immutabile; codice umano separato; migrazione/proiezione con chiave composita compatibile. **Accettazione:** ingest di molti run e ingest ripetuto conservano tutte le occorrenze senza confonderle con clustering o dedup.

### F08 — P0/R — `verified` accettato senza prova e senza audit della transizione

Riferimenti: `packages/server/src/api.ts:258`; `packages/store/src/memory.ts:124`; `packages/schemas/src/finding.ts`.

La route riceve uno status e lo store esegue un cast TypeScript anziché validazione. Una transizione draft → verified con `reproducibility:{}` restituisce HTTP 200, ma lo schema Finding rifiuta il risultato. Actor e reason sono ignorati; nessun evento audit è aggiunto. Il problema riguarda anche stati arbitrari e `duplicate` senza riferimento.

**Intervento:** servizio di transizione con state machine, prerequisiti verificati, validazione runtime e transazione dati+audit. Il client non può attribuirsi da solo un'attestazione. **Accettazione:** transizioni illegali rifiutate e stato originale invariato; replay valido produce una transizione auditabile.

### F09 — P1/R — CLI, report e admin discordano sul risultato del gate

Riferimenti: `packages/kit/src/commands/run.ts:641`; `report.ts:376`; `admin.ts:258`.

Il CLI fallisce quando il profilo richiede replay e ci sono finding. L'evento finale non conserva quell'esito come stato canonico. Il report deriva il risultato dai soli error counter e dal numero di scenari: un gate fallito per finding diventa `succeeded`. L'admin considera riuscito qualsiasi run con `run_finished`.

Riproduzione: `runOk:false`, un finding, `reportState:succeeded`; anche la proiezione admin indica successo. Warning pack non bloccanti e pack selezionati mancanti creano ulteriori rischi di ricostruzione incoerente.

**Intervento:** un solo `RunOutcome` persistito, reason codes, coverage gaps e policy snapshot; CLI/UI/report consumano quello. **Accettazione:** stessa decisione per clean, finding bloccante, warning, missing pack, timeout, crash e abort.

### F10 — P1/R — Il bundle pubblicabile non esegue `run` e `admin`

Riferimenti: `packages/kit/scripts/build-bundle.mjs:69`; `packages/kit/src/commands/run.ts:172`; `admin.ts:202`.

Esbuild produce CJS, ma il codice usa `import.meta.url`. La build avverte che `import.meta` sarà vuoto. Eseguendo `dist/cli.cjs` da un progetto temporaneo inizializzato: `run` esce 2 con `ERR_INVALID_ARG_TYPE`; `admin` esce 2 con `Invalid URL`. `--help` e `--version` possono funzionare comunque.

**Intervento:** resolver degli asset coerente con il formato pubblicato, oppure packaging ESM verificato; non basta zittire il warning. **Accettazione:** creare il tarball, installarlo in directory esterna senza workspace, eseguire il quickstart completo sotto Bun e Node LTS, path con spazi incluso.

### F11 — P1/R+S — Regressione nel comando build e CI già rossa

Riferimenti: `package.json:28`; `.github/workflows/ci.yml`; `.github/workflows/publish.yml`.

Il commit `bb7c472` ha cambiato `build` da compilazione workspace a `npm --prefix docs-site run build`, spostando il primo in `build:workspace`. CI e publish continuano a usare il nome vecchio. La build verde locale è quindi fuorviante; in checkout pulito non genera il bundle richiesto. Il sito ha inoltre un lockfile npm separato non installato da `bun install` root.

**Intervento:** `build:docs` e `build:workspace` espliciti, aggregatore non ambiguo, workflow indipendenti e installazioni frozen per entrambi. **Accettazione:** CI da checkout senza dist/cache e pubblicazione dry-run dell'artefatto testato. L'esito remoto corrente resta FAIL al lint, non una presunta prova che il build abbia già fallito per questa causa.

### F12 — P1/R+S — Salvataggi admin volatili e UI Runs/Findings dimostrativa

Riferimenti: `packages/kit/src/commands/admin.ts:113`; `packages/store/src/postgres.ts:32`; `packages/admin/src/app.tsx:7292,8037`.

Il processo semina `MemoryStore` dai run al boot. Le mutazioni admin non tornano a YAML/JSONL e scompaiono al riavvio. Prova HTTP: organizzazione creata 201 → processo riavviato → lista vuota. La stessa architettura riguarda profili, scenari e stati finding.

Le schermate Runs e Findings consumano `RUNS`/`FINDINGS` statici. Nella prova sul frontend compilato l'apertura di Runs non invia GET `/api/runs`. Alcune altre schermate hanno fetch reali, quindi non è corretto chiamare tutta la UI finta; è proprio questa mescolanza a creare ambiguità.

**Intervento:** repository durevole, migrazioni, mode demo esplicito e isolato, client API tipizzato, nessun fallback a fixture durante errori live. **Accettazione:** modifica dalla UI, osservazione indipendente nel DB, riavvio, pagina nuova, dato identico; successivo `aqa run` usa effettivamente lo scenario modificato.

### F13 — P1/S — Promesse enterprise non implementate

Riferimenti: `packages/auth/src/oidc.ts:21`; `packages/store/src/postgres.ts:32`; `packages/sandbox/src/container.ts:27`; `packages/llm-adapters/src/registry.ts:4`.

OIDC, Postgres, container e tutti i provider LLM live sono scaffold. Il README dichiara GA enterprise e roadmap chiusa. Anche il threat model marca mitigazioni che non trovano enforcement nelle catene esaminate. I test di alcuni package considerano successo proprio il lancio di `not implemented`.

**Intervento:** matrice pubblica `implemented/integrated/production-verified`, collegata a prove eseguibili. Ritirare le promesse non dimostrate e riaprire i task corrispondenti. La policy societaria su certificazioni/compliance richiede una valutazione separata: un catalogo di controlli non è un'attestazione.

### F14 — P0/S — Guardrail dichiarati non attraversati dall'esecuzione reale

Riferimenti: `packages/kit/src/commands/run.ts`; `packages/runner/src/run.ts:67`; `packages/sandbox/src/select.ts`; `packages/cost/src/budget.ts`.

Il percorso CLI→HTTP non invoca sandbox, scanner/firma o budget tracker. URL assoluti nel pack e redirect possono raggiungere destinazioni fuori dal target previsto; non c'è egress allowlist applicata dal runner. `res.text()` non ha limite dimensionale. `parallelism`, `budget_minutes` e budget LLM non governano l'esecuzione corrente.

**Intervento:** dispatcher unico obbligatorio con policy, limiti e cancellazione; capability esplicita prima di eseguire un pack. Per destinazioni private legittime serve allowlist per progetto, non un divieto indiscriminato degli IP privati. Verificare anche redirect, DNS rebinding e budget di risposta. **Accettazione:** test di negazione sul dispatcher reale, nessuna scorciatoia HTTP non controllata.

### F15 — P1/R+S — Replay non dimostra identità del bug

Riferimenti: `packages/runner/src/replay.ts:39`; `packages/reporter/src/replay.ts:34,66`; CLI dispatch.

`verifyScenario` conta qualunque finding come riproduzione. Due tentativi in cui falliscono due oracoli diversi restituiscono `deterministic:true`. Non confronta firma del difetto, condizioni iniziali o risultato originale. `runRun` non chiama il generatore di artefatti: la directory osservata contiene solo events/findings e, dopo report, due report.

Il replay Playwright generato contiene un test senza azioni/assertion; SQL è comment-only. Il curl interpola method/url/header/body senza escaping shell robusto, usa path eventualmente relativi e `-f` interrompe risposte 4xx che potrebbero essere proprio l'esito atteso. Non ho eseguito payload shell ostili.

**Intervento:** bundle di riproduzione con scenario, snapshot, fixture, digest, riferimento ai segreti e failure fingerprint; replay eseguibile e verificato in ambiente fresco. Preferire argv strutturati al codice shell generato. **Accettazione:** stessa violazione presente prima della fix, assente dopo; nessun test vuoto; stringhe con apici/newline non cambiano la struttura del comando.

### F16 — P1/R — Cleanup ignorato

Riferimento: `packages/runner/src/run.ts:91`; schema Scenario `cleanup`/`preconditions`.

Il runner itera solo `steps` e `oracles`. La prova con uno step e un cleanup esegue una chiamata, non due. I preconditions sono testo, senza contratto eseguibile. Prove ripetute possono quindi contaminare lo stato.

**Intervento:** setup/teardown in `try/finally`, compensazioni idempotenti, namespace per run e janitor per crash. **Accettazione:** cleanup su PASS, FAIL, timeout, errore oracle; dopo crash un recovery job rimuove solo risorse appartenenti al run.

### F17 — P1/R+S — Queue non pronta per worker distribuiti

Riferimenti: `packages/server/src/runner-queue.ts:36,50,81`; API runner.

La coda è in memoria; ACK identifica solo il job, senza lease token/worker/epoch. Riproduzione di interleaving: A acquisisce, lease scade, B riacquisisce, ACK di A è accettato e chiude il job di B. È una simulazione deterministica, non un test multiprocesso. `kill` cambia stato ma non invia cancellazione al lavoro; manca un worker eseguibile completo nel package server.

**Intervento:** persistenza, lease token con fencing, heartbeat, dedup, retry limit e dead-letter queue. Side effects idempotenti: non promettere exactly-once distribuito senza un protocollo che lo realizzi. **Accettazione:** due processi reali, restart server/worker, vecchio ACK rifiutato, retry sicuro e nessuna doppia mutazione del SUT.

### F18 — P1/S — Redazione e supply chain non soddisfano il contratto

Riferimenti: `packages/runner/src/events.ts:56`; `findings.ts:28`; `packages/store/src/postgres.ts:34`; `packages/pack-scanner/src/signature.ts:24`; `packages/pack-loader/src/loader.ts`.

I writer persistono payload/summary senza pipeline centralizzata di redazione. Gli oracoli inseriscono il valore cercato nel reason. Postgres include l'intero DSN nell'errore: se contiene credenziali, il messaggio le contiene. Non sono state usate credenziali reali per verificarlo.

`verifySignature` confronta SHA-256 con un valore dichiarato: è un digest, non una firma con identità/trust root. Non copre automaticamente i file del pack, e non è chiamato dal loader. Anche il commento sulla canonicalizzazione non corrisponde alla funzione che hash-a `rawBody`.

**Intervento:** redazione prima di persist/export/prompt, secret references e log sicuri; manifest content-addressed dell'intero pack, firma verificabile e publisher policy, revoca e pinning. **Accettazione:** canary sintetici non appaiono in nessun artefatto; modificare un file firmato invalida il pack prima dell'esecuzione.

### F19 — P1/D — Hash chain locale non prova immutabilità o completezza

Riferimenti: `packages/compliance/src/audit-verify.ts`; `docs/adr/003-hash-chained-audit-log.md`.

La verifica backend rileva modifiche senza rehash, ma chi può riscrivere l'intero file può ricalcolare la catena. Un prefisso valido troncato resta valido senza checkpoint esterno. I finding non sono vincolati crittograficamente nel loro contenuto da `finding_emitted`, che include principalmente ID/severity. Il report non verifica la catena prima di fidarsi degli eventi.

**Intervento:** separare integrità interna, completezza e autenticità; includere digest degli artefatti, seq/run invariants, attestazione finale e checkpoint firmato conservato in un dominio amministrativo distinto. WORM/retention quando richiesti. **Accettazione:** sostituzione/troncamento della run respinti rispetto all'attestazione; backup restore verificato.

### F20 — P1/S — Adapter agenti non conformi al formato skill corrente

Riferimenti: `packages/adapters/src/{claude,codex,gemini,copilot}.ts`; `registry.ts`.

Generano `skills/aqa-run.md`, mentre la [specifica Agent Skills](https://agentskills.io/specification) richiede directory con `SKILL.md`. La discovery effettiva va provata con ogni versione di host supportata; il controllo attuale di esistenza di un file non basta. Claude/Gemini/Copilot delegano inoltre ad AGENTS.md, che viene prodotto dall'adapter Codex: installazioni di un solo target possono lasciare una dipendenza mancante. Le capabilities sono costanti, non negoziazione runtime.

**Intervento:** generatore standard, bootstrap comune sempre presente, contract test per host/versione, aggiornamenti non distruttivi per sezioni gestite e discovery di capability vere. **Accettazione:** installazione in repository pulito, il relativo host scopre e attiva la skill; niente istruzioni che chiedano di eseguire controlli solo “mentalmente”.

### F21 — P2/S — Debito UI e modifiche concorrenti

Riferimenti: `packages/admin/src/app.tsx:1`; `biome.json`; API PUT; `packages/admin-core/src/conflict.ts`.

14.099 righe in un file `@ts-nocheck`, escluso dal lint, molte fixture e stato locale condiviso. Le librerie previste nelle regole non descrivono più fedelmente le dipendenze effettive dell'admin. PUT non usa versioni/ETag, quindi due editor possono perdere modifiche con last-write-wins. Il lock frontend di una card non serializza due sessioni.

**Intervento:** separare gradualmente moduli per dominio, DTO validati e cache query; routing URL; ETag/If-Match e conflitti espliciti; nessuna riscrittura estetica prima dei difetti di verità. **Accettazione:** due browser indipendenti, stale write rifiutata; deep link e reload; accessibilità e viewport richiesti dalle regole.

### F22 — P1/S — Deployment e air-gap non sono prove di operatività

Riferimenti: `deploy/helm/templates/server-deployment.yaml`; `networkpolicy.yaml`; `deploy/terraform/main.tf`; `scripts/air-gap-install.sh`.

Audit server su `emptyDir`, senza persistenza al rimpiazzo del pod. Nel server Deployment mancano readiness/liveness e securityContext. Abilitando ingress, `namespaceSelector:{}` ammette qualunque namespace, non soltanto ingress controller. Terraform crea essenzialmente un namespace. Air-gap usa immagini 0.6.0 contro chart 1.1.0, tollera immagini non salvate e non implementa install. Non ho trovato Dockerfile nel repository; non ne deduco che nessuna immagine esista fuori dal repository.

**Intervento:** prima un deployment singolo realmente funzionante, poi HA; immagini con digest/SBOM, storage durevole, probe, security context, network policy testata, install offline che fallisce se manca un componente. **Accettazione:** cluster fresco, upgrade/rollback, sostituzione pod, restore e install offline senza egress.

### F23 — P2/S — Risk coverage, severity e confidence non sono misure affidabili

Riferimenti: `packages/kit/src/commands/run.ts`; `packages/runner/src/run.ts:128`; `packages/methodology/src/methodology.ts`; `packages/clustering/src/cluster.ts`.

`aqa run` non legge il risk-map del progetto per costruire la copertura, risolvere riferimenti o scegliere severity. Ogni finding ha severity high; confidence è la media di oracoli passati: un unico oracolo che fallisce produce confidence zero. Il peso `oracle.weight` non viene usato. Il clustering cancella numeri e punteggiatura, potendo fondere differenze diagnostiche come codici di stato.

**Intervento:** coverage graph esplicito, risk resolution verificata, severità derivata dall'impatto e confidence calibrata sul fatto che esista il bug. Fingerprint strutturati, distinti dalle occurrence. **Accettazione:** rischio critico senza scenario risulta uncovered, non implicitamente green; bug diversi non si fondono per normalizzazione testuale.

### F24 — P1/R+S — Dipendenze vulnerabili e manutenzione dei due lockfile

Riferimenti: `bun.lock`, `docs-site/package-lock.json`, audit nella sezione 4.

La manutenzione del sito aggiunge una supply chain separata, comprese dipendenze native/ML. La PR Dependabot aperta #59 riguarda linkify-it, ma la superficie è più ampia. Non basta aggiornare il solo package segnalato da quella PR.

**Intervento:** triage reachability, aggiornamenti testati sui due lockfile, policy per advisory con SLA, SBOM dell'artefatto distribuito e scanner su build/runtime distinti. **Accettazione:** zero advisory critici/alti raggiungibili non mitigati; deroghe motivate con scadenza, nessun `audit fix --force` indiscriminato.

## 6. Perché le review precedenti non sono bastate

1. **Contratto confuso con implementazione.** Uno scaffold tipizzato con test “throws not implemented” passa CI, ma non consegna SSO o Postgres.
2. **Test del componente, non del consumatore.** `Finding.parse` è corretto; lo store lo aggira. Il verificatore backend è corretto sul tampering provato; la UI ne usa un altro.
3. **Fixture adattate alla UI.** Hash inventati che mantengono solo i link fanno passare il test audit senza SHA-256.
4. **Artefatto diverso da quello venduto.** Gli smoke provano ESM workspace, gli utenti lanciano CJS bundle.
5. **HTTP 200 scambiato per persistenza.** Il salvataggio in memoria non sopravvive al riavvio e non alimenta il runner da disco.
6. **Test positivi senza SUT intenzionalmente sbagliato.** L'oracolo idempotenza non è stato provato contro duplicati reali.
7. **Gates non allineati.** L'ecosystem test è escluso dalla configurazione Playwright usata dalla CI e non ha un job dedicato nel workflow letto.
8. **Revisione a piccoli pezzi senza prova della promessa intera.** Molte iterazioni locali sui dettagli non sostituiscono un install-from-tarball → finding → replay → fix → reverify.

Le protezioni su path traversal, le collisioni del run directory seeded e alcune validazioni CRUD mostrano lavoro serio. Vanno mantenute; non autorizzano a trasferire la stessa fiducia a sottosistemi non provati.

## 7. Falle teoriche da correggere nel modello

### 7.1 “Nessun finding” non implica “rischio controllato”

Serve distinguere scenario selezionato, avviato, osservato e verificato. Un test unsupported, escluso per tag o fallito prima di autenticarsi non aggiunge evidenza positiva. Il gate deve vedere il denominatore dei rischi obbligatori, non solo contare finding.

### 7.2 N/N retry non dimostra determinismo universale

È evidenza empirica sul contesto provato. Tre successi su tre non garantiscono alta affidabilità statistica: con limite inferiore binomiale esatto unilaterale al 95%, per 3/3 il limite è circa 0,368; per 30/30 circa 0,905. Sono calcoli matematici, non benchmark del prodotto. Modellare numero di tentativi, condizioni, reset, identità della failure e intervallo di confidenza. Tenere separati replay di una trace registrata e nuova esecuzione del sistema stocastico.

### 7.3 L'LLM può aiutare a scoprire; non deve autoattestarsi

Un agente che genera test e giudica il proprio successo può convergere su una verifica compiacente. Separare proponente, esecutore e verificatore; attestare stato del DB, permessi e side effect con controlli deterministici quando possibile. Un ensemble di modelli non garantisce indipendenza: possono condividere bias e training.

### 7.4 Preconditions e sessione fanno parte della prova

“401 ottenuto” non prova token rotation se il token non è mai stato valido. “HTTP 200” non prova pagamento, webhook o consegna. Il test deve legare identità iniziale, transizione, stato durevole, nuova sessione e denial dei permessi precedenti.

### 7.5 Il sistema sotto test è una fonte non fidata

HTML, tool output, screenshot, file di pack e risposte API possono contenere istruzioni avversarie. L'agent QA deve avere capability limitate, memoria separata fra tenant e separazione fra dati osservati e policy. Un framing testuale non equivale a sandbox.

### 7.6 Safety e liveness

Verificare sia “mai una mutazione non autorizzata” sia “l'operazione legittima prima o poi termina”. Un blocco totale può far passare tutti gli assert negativi. Timeouts, budget e queue devono essere provati contro lavoro ancora attivo dopo la cancellazione.

### 7.7 Copertura per tassonomia non è efficacia

Avere tag STRIDE/OWASP non dimostra che i test rilevino vulnerabilità. FMEA moltiplica scale ordinali: usarlo per discussione e priorità, senza trasformarlo in una probabilità quantitativa di incidente.

## 8. Stato dell'arte al 17 settembre 2026

**Il divario non deriva soltanto da evoluzioni recenti.** Numerose capacità erano già nel blueprint originario e non sono state completate. Distinguere quindi recupero dell'implementazione e innovazione nuova.

### 8.1 Da file di istruzioni a integrazioni operative

Agent Skills ha un formato interoperabile basato su directory e `SKILL.md`. AQA dovrebbe adottarlo con test di discovery reali. Un adapter moderno deve dichiarare versione host, capability, limiti e ultimo test di compatibilità. [Specifica ufficiale](https://agentskills.io/specification).

MCP ha pubblicato la revisione **2026-07-28**: core stateless, evoluzione dell'autorizzazione e Tasks come estensione. Non progettare un nuovo server assumendo che l'API sperimentale Tasks 2025-11-25 sia il contratto definitivo. Per AQA: tool sicuri di pianificazione, avvio limitato, polling, cancel e lettura delle prove, con protocol/version negotiation. [Annuncio ufficiale](https://blog.modelcontextprotocol.io/posts/2026-07-28/).

A2A distingue comunicazione fra agenti da collegamento agente-tool tramite MCP. È una futura integrazione per QA delegata fra sistemi, non una dipendenza obbligatoria del primo prodotto affidabile. [Documentazione A2A](https://a2a-protocol.org/latest/).

### 8.2 Testing browser agentico già disponibile

Playwright documenta agenti **planner, generator, healer**. Quindi “un agente scrive test Playwright” da solo non è un vantaggio competitivo. AQA può aggiungere invarianti di business, percorsi cross-role, evidenza durevole e policy di rilascio. L'healing non deve cambiare aspettative, indebolire assert o accettare una regressione di prodotto. [Playwright Test Agents](https://playwright.dev/docs/test-agents).

Stagehand offre primitive AI e controllo browser deterministico; la documentazione corrente è v4. Valutarlo come driver opzionale di esplorazione, conservando test ripetibili e un oracle indipendente. Non assumere che un'azione self-healed sia una prova valida del requisito. [Stagehand](https://docs.stagehand.dev/v4/first-steps/introduction).

### 8.3 API testing generativo e stateful

Schemathesis genera test da OpenAPI/GraphQL e compone workflow stateful. Reimplementare un fuzzer API completo in AQA aumenta il costo senza garantire vantaggio. Meglio importarne risultati, seed e riproduzioni nel grafo dei rischi. [Schemathesis](https://schemathesis.readthedocs.io/en/stable/), [stateful testing](https://schemathesis.readthedocs.io/en/stable/explanations/stateful/).

### 8.4 Evals di agenti: esito, step e traiettoria

LangSmith documenta valutazioni della risposta finale, dei singoli passi e della traiettoria, oltre a valutazioni offline/online. Il suo Engine descrive un ciclo trace → problema → proposta → evaluator ed esempi di regressione, dichiarandosi Beta. AQA ha oggi fixture LLM e una coda in memoria, non un flusso equivalente. [Evaluation approaches](https://docs.langchain.com/langsmith/evaluation-approaches), [evaluation types](https://docs.langchain.com/langsmith/evaluation-types), [Engine](https://docs.langchain.com/langsmith/engine).

Anthropic distingue transcript e stato finale dell'ambiente, propone grader deterministici/modello/umani e trial ripetuti, separando capability eval e regression eval. Per AQA l'output importante deve essere “lo stato è corretto e i permessi sono rispettati”, non “l'agente ha dichiarato successo”. [Demystifying evals for AI agents, 9 gennaio 2026](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents).

### 8.5 Sicurezza agentica più ampia della stringa “PWNED”

Promptfoo documenta generazione ed esecuzione di test avversari con plugin e strategie. È un candidato da integrare per red teaming, non da sostituire con un unico prompt-injection YAML. [Quickstart ufficiale](https://www.promptfoo.dev/docs/red-team/quickstart/).

L'OWASP Agentic Top 10 2026 è pubblicato dal 9 dicembre 2025. Il pack AQA contiene solo tre seed e usa una nomenclatura A01/A02/A03 che non va presentata come corrispondenza completa alla tassonomia ASI. Aggiornare una mappa versionata e verificata, con scenari concreti. [OWASP Agentic Top 10](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/).

OWASP presenta inoltre **Agent Control Standard**, datato 1 settembre 2026, per hook e policy runtime portabili. È interessante per una futura policy layer; non è una certificazione né sostituisce l'enforcement del sistema operativo. [ACS](https://genai.owasp.org/resource/agent-control-standard-acs/).

### 8.6 Osservabilità e manutenzione della piattaforma

Le convenzioni GenAI OpenTelemetry sono in evoluzione e la documentazione segnala lo spostamento nel repository dedicato. Integrare trace/span ID stabili nel dominio AQA, mantenendo il mapping OTel versionato e i contenuti sensibili opt-in/redatti. Non congelare nomi sperimentali senza migration policy. [OpenTelemetry GenAI](https://opentelemetry.io/docs/specs/semconv/gen-ai/).

Node 22 è ancora LTS; Node 24 è anch'esso LTS ed è la scelta da valutare come baseline operativa. Il Node 25 locale di questa review risulta EOL nella tabella ufficiale e non sostituisce un gate LTS. Vite 6.4 riceve ancora security patch, mentre la linea corrente indicata dalla pagina è 8.3: priorità a patch e compatibilità, non upgrade di major come sostituto delle correzioni architetturali. [Node releases](https://nodejs.org/en/about/previous-releases), [Vite releases](https://vite.dev/releases).

### 8.7 Confronto competitivo corretto

| Categoria | Capacità documentata da altri | Opportunità AQA |
| --- | --- | --- |
| Playwright Test Agents | Pianificazione, generazione e healing | Vincolare i test a rischi e prove dello stato di business |
| Schemathesis | Generazione API e workflow stateful | Unificare failure API e percorsi browser/permessi |
| Promptfoo | Evals/red teaming avversario | Legare la sicurezza LLM agli effetti reali dei tool |
| LangSmith | Trace, dataset, eval offline/online | Prova cross-system e release decision indipendente dal provider |
| Stagehand | Automazione browser ibrida AI/codice | Esplorare, poi compilare la scoperta in regressione verificabile |

È un confronto di capacità documentate, **non un benchmark di qualità/prezzo**. Non ci sono dati per affermare che AQA sia superiore. La tabella commerciale attuale va sostituita con confronti nominativi, versionati, riproducibili e con ambiti espliciti.

## 9. Posizionamento proposto

**AQA come sistema delle prove di qualità per software e agenti**, interoperabile e self-hosted: dalla modifica al rischio, dal rischio alla verifica, dalla verifica a un'attestazione controllabile.

Il vantaggio da costruire è la capacità di rispondere con prove alla domanda: **“Perché possiamo rilasciare questa modifica, quali percorsi sono stati verificati e quali restano scoperti?”**

Architettura proposta:

```text
Git diff / requisiti / OpenAPI / trace redatte
                    |
          Grafo rischi e percorsi
                    |
      Piano versionato + policy + budget
                    |
    Dispatcher autorizzato e isolato
       |            |              |
   Browser       API/DB       Agent/MCP/LLM
       +------------+--------------+
                    |
   Oracle indipendenti su stato e side effect
                    |
       Evidenze content-addressed + replay
                    |
    Verifica della fix e decisione di rilascio
                    |
      API / UI / CI / attestazione firmata
```

Partirei da un monolite modulare con worker separato e storage serio. I 20 package non giustificano 20 microservizi. Distribuire soltanto dove servono isolamento o scalabilità provata.

## 10. Espansioni importanti, ordinate per valore

### E1 — Grafo delle prove e copertura dei percorsi

Entità: Requirement, Risk, Invariant, Journey, Actor, ScenarioRevision, Attempt, Observation, OracleResult, FindingOccurrence, ReplayBundle, ReleaseDecision. Ogni arco conserva commit, versione policy e ambiente.

La UI mostra rischi uncovered, stale, blocked, flaky e verified con motivazione. Coverage calcolata sui rischi obbligatori e i percorsi per ruolo, non sul numero di YAML. Primo vertical slice: cambio ruolo → permessi aggiornati → vecchia sessione negata → nuova sessione autorizzata.

**Successo:** ogni decisione di rilascio è ricostruibile dagli artefatti; nessun rischio obbligatorio sparisce perché un driver manca.

### E2 — Compilatore di journey stateful

Da specifica e API derive un piano con attori, cookie jar, token reference, setup, data extraction, attese, condizioni, cleanup e osservatori DB. AI propone il piano; compiler e policy lo validano prima del run.

Supportare prima HTTP + Playwright + osservazione DB read-only; poi queue/webhook. Schemathesis come driver generativo. Test di race con barriere riproducibili e processi indipendenti, conservando una distinzione esplicita dalle simulazioni.

**Successo:** un percorso pagamento sintetico/staging o cambio entitlement dimostra effetti persistiti, retry idempotente e isolamento tenant senza canonicalizzare artificiosamente gli ID reali.

### E3 — Laboratorio di sicurezza agentica

Target: prompt injection multi-turn, poisoning di tool output/memoria, escalation di capability, abuso delle approvazioni, esfiltrazione, budget exhaustion, delegazione e isolamento cross-user. Canary sintetici e endpoint sink controllati.

L'oracolo osserva tool invocati, argomenti, egress e modifiche, oltre al testo. Promptfoo può generare attacchi; AQA conserva la prova dell'effetto o del rifiuto. Aggiungere pack di conformità MCP con auth, cancellazione e isolamento task; A2A soltanto quando un cliente lo richiede.

**Successo:** misurare attacchi riusciti e false denial sul lavoro legittimo; una risposta “non posso” con un tool distruttivo già eseguito deve essere FAIL.

### E4 — Replay capsule e verifica della fix

Bundle content-addressed: codice/revisione, lockfile, image digest, fixture redatte, clock/seed quando controllabili, trace HTTP/browser, oracle e fingerprint. Separare replay offline di registrazioni da riesecuzione live.

Flusso: scoperta → minimizzazione → replay in ambiente fresco → proposta regressione → fix → replay sulla fix → test di non regressione. Un healer può proporre un nuovo locator, ma non alterare l'invariante senza review.

**Successo:** un collega riproduce il difetto senza informazioni extra; il sistema dimostra stesso difetto prima e assenza dopo, non semplicemente due build verdi.

### E5 — Valutazione dei modelli e degli agent harness

Dataset curati e holdout; multi-trial; success rate, unsafe action rate, cost per successful task, latenza e intervalli di confidenza. Pin provider/model/prompt/tool schema/runtime e non inventare version hash che il provider non espone.

Aggiungere giudici calibrati su esempi umani, blind/pairwise quando appropriato e valutazioni dello stato finale. La scelta del modello diventa esperimento, non una classifica universale. Non salvare chain-of-thought privata: bastano risultati osservabili, tool calls e spiegazioni sintetiche consentite.

**Successo:** cambio modello/prompt/tool mostra regressioni per percorso, non solo una media aggregata che nasconde la perdita di un controllo critico.

### E6 — Da incidente a regressione, con approvazione

Import di trace OTel redatte, raggruppamento di anomalie, proposta di scenario minimo e revisione umana; replay in staging; promozione a suite di regressione. Dati di produzione esclusi o minimizzati secondo policy.

**Successo:** riduzione del tempo da incidente a test eseguibile; nessun trasferimento automatico di PII né replay distruttivo su produzione.

### E7 — Control plane enterprise verificabile

SSO/OIDC, RBAC+scope, service account, worker identity, project quotas, lease durevoli, artifact store, audit indipendente, API versionate e webhook firmati. Secret manager, rotation e cancellazione effettiva dei job.

Budget: riserva prima della chiamata, riconciliazione dopo, ledger per tenant, prezzo sconosciuto rifiutato o stimato conservativamente. Una soglia misurata soltanto dopo il consumo non è un hard cap.

**Successo:** kill del processo e failover non perdono decisioni/artefatti; due worker non superano la quota comune e non completano lo stesso lease.

### E8 — Marketplace affidabile e pacchetti verticali

Pack firmati con provenienza, SBOM, permessi dichiarati, capability review, version pinning e revoca. Separare contenuti descrittivi, generatori e codice eseguibile.

Primi verticali: multi-tenant SaaS, auth/session rotation, webhook/idempotency, agent tool permissions, migrazioni dati. Un pack diventa “verified” solo se fallisce contro un SUT intenzionalmente vulnerabile e passa contro quello corretto.

**Successo:** conformance suite pubblica del pack; ogni controllo dichiara prerequisiti, ambiente, falsi positivi noti e limiti.

## 11. Come dimostrare una superiorità reale

Costruire un benchmark riproducibile con almeno quattro famiglie: API stateful, percorsi browser, isolamento auth/tenant, agenti con tool. Ogni task contiene variante corretta, variante difettosa e oracle di ground truth indipendente. Holdout non visibile al planner; budget e timeout uguali tra alternative.

Metriche principali:

- Recall su difetti seminati e difetti storici reali.
- Precision dei finding confermati e tasso di falso verde.
- Riproducibilità dello **stesso** difetto in ambiente fresco.
- Copertura per ruolo/tenant e per transizione di stato.
- Minuti di triage umano e costo per bug valido.
- Resistenza a test tampering, oracle weakening e dati incompleti.

Confronti: suite manuale Playwright/Schemathesis; host agent senza AQA; host con sole istruzioni AQA; pipeline AQA completa; red-team specialistico sul sottoinsieme LLM. Pubblicare configurazioni e limiti. Se AQA vince solo sulla composizione cross-system, rivendicare quella superiorità circoscritta.

Valutare anche il costo marginale: orchestrare tre strumenti per trovare lo stesso difetto di un test da 20 righe potrebbe peggiorare il prodotto.

## 12. Piano di delivery proposto

Le finestre seguenti sono stime di pianificazione, non promesse: assumono un piccolo team con competenze backend/security, QA e frontend, più review indipendente. L'uscita da ogni fase dipende dalle prove.

| Fase | Obiettivo | Gate di uscita |
| --- | --- | --- |
| 0 — immediata, indicativamente 1 settimana | Correggere claim, CI/build/package, classificazione demo/live; bloccare i falsi verdi | Fresh checkout + tarball smoke; driver assente non passa; lista dei percorsi non supportati |
| 1 — indicativamente 2–4 settimane | Motore attendibile, ID, outcome canonico, oracle e replay, audit vero | Tutte le riproduzioni F01–F10 diventano test di regressione pertinenti; SUT difettosi rilevati |
| 2 — indicativamente 4–8 settimane | Persistenza locale/PG, auth/tenant, API e admin veri | UI compilata → API → DB → riavvio → rilettura; denials senza effetti; nessuna fixture live |
| 3 — indicativamente 4–8 settimane | Worker/sandbox/policy/costi/artifact store/deploy | Fault/race multiprocesso, backup restore, egress deny e cancellazione provati |
| 4 — dopo fondamenta stabili | MCP/skills, integrazioni driver, benchmark e vertical pack | Contratti host/protocollo verificati e vantaggio misurato sul corpus |

La somma non è una data commerciale: integrazioni IdP, browser, database e operations possono ampliare il lavoro. Un pilot locale limitato può arrivare prima; produzione enterprise condivisa richiede tutte le fasi pertinenti.

Ogni PR deve descrivere la promessa precisa, riproduzione prima della fix, evidenza dopo, cause del mancato rilevamento precedente e limiti residui. Per PR dipendenti usare `gh stack`, conservando CI e review obbligatorie. Non aprire molte feature prima che le fondamenta precedenti siano integrate e provate.

## 13. Matrice minima di accettazione produzione

| Journey | Prova positiva | Prova negativa/fault |
| --- | --- | --- |
| Installazione | Tarball in progetto esterno → init → run → report → admin | Asset mancanti, path con spazi, Node/Bun supportati, install senza workspace |
| Gate | SUT corretto PASS con coverage completa | Target down, missing driver, oracle invalido, scenario saltato: mai PASS |
| Idempotenza/auth | Stato DB uguale al replay; token vecchio negato e nuovo valido | Due creazioni rilevate; token mai inviato non è una prova valida |
| Finding | Due run conservano due occurrence; triage valido e persistito | Collisioni, duplicate senza target, verified senza prova rifiutati |
| Audit | UI e CLI concordano sullo stesso record completo | Tamper, troncamento rispetto a checkpoint, reorder e cross-run mix |
| Admin editing | UI compilata → API → DB → nuova sessione/restart → runner usa revisione | Stale write 409/412; errore DB nessun salvataggio ottimistico definitivo |
| Tenant | Tenant autorizzato legge/modifica le proprie risorse | Tenant B e ruolo inferiore negati su ogni API/artifact; nessun side effect |
| Queue | Due worker con lease e risultato durevole | Crash, retry, vecchio ACK, timeout e cancel reale |
| Sandbox | SUT consentito raggiungibile | Host/egress non autorizzati bloccati; budget output/CPU/memoria provati |
| Secrets | Segreti utilizzati per l'azione tramite reference | Canary sintetici assenti in log, trace, screenshot, report e replay |
| LLM | Task riuscito, side effect corretto, budget riconciliato | Provider down, prompt injection, costo ignoto, quota concorrente |
| Deployment | Upgrade e restore con dati/artefatti integri | Pod replacement, database indisponibile, install offline incompleto |

Coverage del codice ≥80% dove richiesto resta un requisito utile ma non basta. Aggiungere mutation testing selettivo sugli oracoli, authorization e policy: se disabilitare il controllo lascia verdi i test, quei test non proteggono la promessa.

## 14. Ordine delle decisioni

1. Accettare lo stato reale come base: roadmap da riaprire, claim enterprise da correggere.
2. Scegliere il primo percorso di valore: API stateful e tenant/auth con HTTP+browser+DB è una proposta concreta.
3. Rendere impossibili i falsi verdi prima di ampliare il catalogo.
4. Unificare outcome, persistenza e prove prima di aggiungere dashboard.
5. Integrare strumenti specialistici dietro contratti; concentrare lo sviluppo proprio su evidenza, policy e copertura del rischio.
6. Promuovere a enterprise solo sulla base di test operativi, benchmark e pilot verificati.

La direzione consigliata è ambiziosa ma verificabile: **un sistema in cui ogni verde può essere spiegato e ricontrollato, e ogni assenza di prova resta visibile**.
