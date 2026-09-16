# AQA Commerce Assurance — proposta architetturale

Data: 2026-09-17. Base esaminata: `044135cdee0aaaf2e865ca10381ef5e4052ed22e`.

Stato: **proposta per revisione del maintainer, non implementata né approvata per delivery**. Completa la [deep review](enterprise-review-2026-09-17.md). Le funzionalità qui progettate appartengono al toolkit QA che verifica un e-commerce, non a un nuovo motore commerciale da costruire dentro AQA.

## 1. Esigenza e copertura effettiva

Nel catalogo attuale ci sono `core`, `api-core`, `web-ui`, `security`, `llm-agent`. Non c'è un pack commerce con modelli di ordine, denaro, disponibilità, pagamento o reso. Lo scenario generico di idempotenza non verifica attualmente l'uguaglianza degli ID come dichiarato; quello di token replay non dimostra l'utilizzo del token revocato. Un checkout verde costruito sopra queste primitive sarebbe una falsa rassicurazione.

Gli schemi di scenario offrono sequenze di probe e configurazioni generiche, ma non contratti eseguibili completi per sessioni concorrenti, estrazione dati tipizzata, scadenze di convergenza, riconciliazione tra provider e database, oppure compensazione durevole. Dichiarare un probe `sql` o `playwright` nello schema non equivale ad avere il driver operativo nel percorso CLI.

Assunzioni di questa proposta: primo pilot B2C con beni fisici, una valuta per ordine, un merchant, checkout web e provider di pagamento in sandbox. Multi-valuta, B2B, marketplace e abbonamenti sono moduli successivi, non prerequisiti universali. Piattaforma, provider, paese, volumi e regole fiscali non sono stati comunicati: gli adapter e le policy restano configurabili; non si assume Shopify, Stripe o una normativa particolare come requisito del progetto.

Obiettivo: dimostrare che **il cliente ottiene il risultato promesso e che denaro, ordine, magazzino e side effect restano coerenti anche con retry, concorrenza e guasti**.

## 2. Tre alternative

| Approccio | Vantaggio | Limite / costo |
| --- | --- | --- |
| Solo nuovi YAML con HTTP | Rapido per smoke API elementari | Non copre browser, stato durevole, race e provider; oggi eredita falsi verdi |
| **Journey engine condiviso + pack commerce + adapter** | Riusa il core; contratti di dominio e prove indipendenti; estensibile | Richiede prima di correggere runner, outcome, sandbox, store e policy |
| Piattaforma commerce QA separata | Massima specializzazione | Duplica orchestrazione, sicurezza, UI e manutenzione; prematuro |

Raccomandazione: seconda opzione. Il dominio commerce è un banco di prova severo per il motore generico, non una scorciatoia per evitare i difetti della review. Un primo pack circoscritto è preferibile a venti integrazioni superficiali.

## 3. Catalogo funzionale da coprire

Le righe seguenti sono requisiti proposti, **non funzionalità già presenti**. P0 = integrità di denaro/stato o sicurezza; P1 = affidabilità del percorso commerciale; P2 = estensione dipendente dal modello di business. La priorità diventa P0 quando una funzione è il core business del merchant, per esempio abbonamenti o marketplace.

| Area / pack proposto | Verifiche specifiche | Prova indipendente richiesta | Priorità |
| --- | --- | --- | --- |
| Catalogo e varianti | SKU corretto, varianti incompatibili, prodotto disabilitato, prezzo per canale | API catalogo + selezione effettiva nell'ordine | P1 |
| Ricerca e navigazione | Filtri combinati, paginazione, ordinamento, risultati vuoti, link prodotto | Dataset noto; proprietà sui risultati, non screenshot soltanto | P1 |
| Carrello | Aggiunta/rimozione, quantità limite, carrello guest, merge al login, multi-tab, prezzi cambiati | Carrello server riletto da nuova sessione autorizzata | P0/P1 |
| Prezzi e arrotondamenti | Quantità, valuta, precisione, sconto per riga/ordine, arrotondamento dichiarato | Calcolo reference indipendente e versione policy | P0 |
| Promozioni | Esclusioni, cumulabilità, uso singolo, scadenza, concorrenza, manipolazione client | Contatore redemption e prezzi finali persistiti | P0 |
| Checkout | Guest/account, indirizzo, metodi consegna, ritorno browser, refresh/doppio click | Ordine persistito associato al checkout corretto | P0 |
| Pagamenti | Autorizzazione/cattura, rifiuto, challenge, redirect, pending, timeout ambiguo, retry | Stato provider sandbox + ledger merchant, non return URL | P0 |
| Webhook | Duplicati, riordino, ritardo, firma invalida, replay, event version | Inbox/outbox e side effect durevoli per chiave business | P0 |
| Disponibilità | Ultimo pezzo, reservation TTL, rilascio, multiwarehouse, backorder policy | Snapshot coerente inventory e reservation | P0 |
| Ordini | Transizioni valide, cancel-versus-capture, modifica, ordine orfano, notifica singola | Order revision + ledger + eventi elaborati | P0 |
| Spedizioni | Quote, soglie free shipping, zone escluse, split shipment, carrier down | Fulfillment e quote versionata; nessuna etichetta reale in test | P1 |
| Resi e rimborsi | Parziale/totale, quantità resa, spedizione, sconti ripartiti, retry concorrenti | Refund provider + allocazione merchant + stock disposition | P0 |
| Gift card / credito | Saldo, redeem concorrente, mix payment, rimborso sul tender corretto | Ledger append-only e saldo derivato | P0 se supportato |
| Account e autorizzazioni | Order IDOR, reso di altro utente, guest link, indirizzi, admin role | Denial e assenza di ogni mutazione/artefatto esposto | P0 |
| Comunicazioni | Conferma ordine, pagamento fallito, spedizione, reso, destinatario corretto | Mail/SMS sink sintetico; contenuto redatto e conteggio effetti | P1 |
| Analytics | Purchase non duplicato, cancel/refund coerenti, consenso, valuta/importo | Event sink di test; nessun evento su proprietà analytics reale | P1 |
| Accessibilità / mobile | Tastiera, focus/errori, screen reader, zoom, input touch, loading states | Percorso checkout assistito + automazione; non solo scanner | P1 |
| Prestazioni / resilienza | Picchi stock, latenza provider, saturazione queue, backpressure | Percentili e correttezza sotto carico autorizzato | P1 |
| Localizzazione / imposte | Separatori, fuso orario, cambio data, IVA inclusa/esclusa secondo policy | Dataset reference approvato dal merchant; non giudizio LLM | P1 |
| B2B | Listini riservati, MOQ, approvazione acquisti, plafond, pagamento differito | Identità aziendale + stato credit/order | P2 |
| Abbonamenti | Trial, rinnovo, prorata, dunning, cancel, webhook tardivi | Clock di test/provider supportato + entitlement durevole | P2 |
| Marketplace | Split payment, commissioni, tenant venditore, refund allocati, payout | Ledger per seller e provider; nessun dato cross-merchant | P2 |
| Digitale / prenotazioni | Entitlement, download, accesso revocato, slot concorrente | Stato accesso/prenotazione dopo callback e retry | P2 |
| Assistente AI commerce | Prezzi inventati, sconti non autorizzati, prompt injection, acquisti/rimborsi senza consenso | Tool policy, decisioni e side effect reali controllati | P0 se presente |

Per accessibilità usare una baseline esplicita come WCAG 2.2 con criteri scelti; i controlli automatici coprono solo parte del lavoro. Non presentare l'esito come certificazione normativa. [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/).

## 4. Architettura e confini

```text
Commerce pack: rischi + invarianti + journey + fixture manifest
                         |
                  Scenario compiler
             capabilities + policy preflight
                         |
            Journey engine / session isolation
        /          |           |           \
     Browser     HTTP       Webhook      Fault/clock
        \          |           |           /
                 Merchant SUT isolato
                 /       |         \
             Orders   Inventory   Payment sandbox
                 \       |         /
              Read-only domain observers
                         |
              Deterministic domain oracles
                         |
       Evidence store -> finding / release gate / report
                         |
             Cleanup + reconciliation ledger
```

**Pack**: `packs/commerce-core`, poi `commerce-payments`, `commerce-inventory`, `commerce-postpurchase`, `commerce-agent-security`. Il primo contiene il modello comune; gli altri dipendono da una versione esplicita del contratto. Nuovi package runtime solo quando servono realmente: evitare subito un microservizio per ogni dominio.

**Adapter merchant**: descrive capability e mapping verso carrello, checkout, ordine, stock, auth e osservatori read-only. Una piattaforma hosted può non esporre DB o fault injection: lo dichiara; il report indica prova parziale/unsupported, non simula una prova equivalente. Supportare inizialmente un adapter HTTP reference e il merchant del pilot; solo successivamente Shopify/WooCommerce/Magento o custom con contract test per versione.

**Adapter pagamento**: separato da quello merchant, con capability di creazione fixture, lettura transazioni, flussi pending/challenge e consegna eventi test. I segreti sono reference, non valori nel pack. I metodi non disponibili non si emulano spacciandoli per provider reale.

**Fault adapter**: può introdurre timeout, interrompere worker o ritardare eventi soltanto sull'ambiente allowlisted con autorizzazione specifica. In un SaaS esterno non controllato può essere impossibile riprodurre alcuni crash: registrare il limite.

**Oracolo**: confronta osservazioni indipendenti e tipizzate. LLM utile per suggerire un journey, classificare un'anomalia o spiegare un finding; non arbitro finale di importi, autorizzazioni, stock e stato pagamento.

**Isolamento**: per run namespace dati, sessioni cookie/token separate per attore, limiti di concorrenza; con credenziali condivise distinguere ciò che è isolabile da ciò che richiede un ambiente separato. Condividere un browser context tra clienti annulla la validità dei test di isolamento.

**Persistenza**: metadati/esecuzioni in storage transazionale dietro astrazione; artefatti in object store o storage locale durevole. Una reservation del SUT non è un lock del runner: i due concetti non vanno confusi.

## 5. Contratti dati proposti

Contratti nuovi, da formalizzare in uno schema versionato prima di scrivere pack eseguibili. Non infilare sintassi nuova in `with` senza validazione.

| Contratto | Campi e vincoli essenziali |
| --- | --- |
| `Money` | currency + minor-unit amount serializzato come intero decimale stringa; metadati precisione; niente float binario; la scala non è sempre 2 |
| `CommerceContext` | merchant/environment/tenant, run ID, policy revision, feature capabilities, actor references; nessun token inline |
| `ActorSession` | actor ID, ruolo, tenant, auth reference, cookie jar isolato, expiry, cleanup owner |
| `OrderSnapshot` | ID/revision, righe con SKU/qty/importi, componenti fiscali e sconti, tender allocation, stato business |
| `PaymentSnapshot` | provider reference, payment/attempt/capture/refund IDs, amount/currency, stato e fonte osservazione |
| `InventorySnapshot` | SKU/location, on-hand, reserved, committed secondo mapping dichiarato, policy backorder, revision/as-of |
| `Observation` | tipo/fonte, schema revision, timestamp e freshness, correlation ID, redacted digest, riferimento artefatto |
| `EffectExpectation` | chiave business, predicato/count atteso, deadline, stato terminale consentito, fonte autorevole |
| `CompensationRecord` | risorsa creata, owner/run, azione autorizzata, retry/deadline, esito, residuo da riconciliare |
| `JourneyOutcome` | pass / fail / error / inconclusive / blocked / unsupported; evidence completeness e motivazione distinte dall'esito |

Ogni osservatore restituisce `unsupported` se non ha accesso alla prova, non un oggetto vuoto assimilabile a successo. Per denaro preservare valuta in tutte le operazioni; vietare somme cross-currency senza operazione FX esplicita e tasso/versione applicata.

Transizioni commerce dipendono dal modello del merchant. Non imporre una catena universale `paid -> shipped`: contrassegno, preordine e pagamento differito sono legittimi. Il pack seleziona un profilo e valida rispetto a quello.

## 6. Invarianti da implementare

1. **Checkout idempotente**: più invocazioni della stessa operazione logica, con identica chiave e payload compatibile, non creano ulteriori ordini/addebiti. Payload differente con stessa chiave segue un contratto esplicito, non successo silenzioso.
2. **Reconciliation pagamento**: per ogni ordine, catture, storni, refund e tender allocation sono coerenti con ledger e provider; un redirect di successo non prova una cattura.
3. **Limite refund**: per ogni tender, rimborsi confermati e quote riservate per refund concorrenti non superano la cattura rimborsabile, salvo rettifiche esplicitamente modellate. Chargeback e fee non sono semplici refund.
4. **Disponibilità**: sotto policy no-backorder, quantità impegnata non supera quella vendibile nel punto di serializzazione; gli snapshot confrontati devono avere revisioni compatibili. Per backorder verificare limite e promessa, non vietarlo sempre.
5. **Prezzo affidabile**: il totale server rispetta la policy versionata; prezzo/sconto inviato dal browser non prevale sulle regole autorizzate.
6. **Allocazione denaro**: somma importi righe e componenti secondo semantica dichiarata coincide con il totale; gift card e store credit sono tender, non automaticamente sconti. Non aggiungere due volte imposte già incluse.
7. **Effetto webhook**: molte consegne possono avvenire; l'effetto business deve essere unico per la chiave adeguata. L'ID evento da solo non copre tutti i casi di eventi diversi relativi allo stesso effetto.
8. **Liveness**: uno stato pending deve convergere o produrre una riconciliazione/escalation entro la deadline del profilo. Non basta dimostrare che non è successo qualcosa di sbagliato nel primo secondo.
9. **Accesso**: attore non autorizzato non legge né modifica ordine, indirizzo, rimborso o artefatti di un altro cliente/tenant, anche conoscendo gli ID.
10. **Cleanup**: ogni risorsa sintetica è riconciliata; gli effetti esterni non annullabili restano elencati e richiedono intervento. Un failure del cleanup deve essere visibile nel gate operativo.

Le scadenze non possono essere scelte per far passare il test: configurarle dagli SLA attesi e registrare il tempo osservato. Webhook Stripe, per esempio, non garantiscono ordine di consegna e richiedono gestione dei duplicati: sono condizioni normali da progettare, non solo guasti artificiali. [Stripe webhook](https://docs.stripe.com/webhooks?lang=node).

## 7. Dieci journey prioritari, con criteri verificabili

### EC-01 — acquisto completo e nuova sessione

Fixture: cliente sintetico, SKU con disponibilità nota, policy prezzo versionata, gateway sandbox. Browser compilato: ricerca → variante → carrello → indirizzo → spedizione → checkout → eventuale challenge → conferma. Rileggere l'ordine via API autorevole, confrontare provider e inventory, aprire nuova sessione cliente e verificare storico. Riavviare il componente merchant controllabile per dimostrare durabilità; per hosted dichiarare che il riavvio non è testabile. Confermare una sola notifica nel sink. Pass solo con tutte le prove pertinenti, non perché appare “grazie”.

### EC-02 — pagamento riuscito ma risposta persa

Fault autorizzato dopo l'effetto provider e prima della risposta merchant. Client riprova la stessa operazione; callback originale arriva in ritardo. Verificare un ordine logico, importo catturato corretto, nessun secondo addebito e stato finale riconciliato. Se il provider non permette questo fault, eseguire un test integration controllato e tenerlo distinto dal test live sandbox. Non riutilizzare una chiave oltre il contratto di retention del provider presumendo idempotenza infinita. [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests).

### EC-03 — ultimo pezzo e concorrenza reale

Uno SKU, una unità vendibile, due clienti/sessioni indipendenti; barriera controllata prima della reservation/commit, non due richieste quasi contemporanee senza evidenza di sovrapposizione. In modalità no-backorder: un solo acquisto evadibile, nessuna disponibilità negativa, secondo cliente con risposta coerente; eventuale autorizzazione perdente annullata/rilasciata secondo policy. Ripetere interleaving e seed; una singola esecuzione non dimostra assenza universale di race.

### EC-04 — doppia consegna webhook e crash

Consegna concorrente dello stesso evento; kill del worker di test nei confini prima/dopo persist dell'effetto; retry e riavvio. Invertire anche due eventi logicamente successivi. Accettazione: stato ordine valido, un solo effetto business, inbox/outbox riconciliate e nessun rollback di uno stato terminale valido causato dall'evento vecchio. Richiesta con firma errata negata senza mutazioni. Se si conserva body firmato, redazione e protezione devono evitare di renderlo una credenziale riutilizzabile.

### EC-05 — promozione monouso concorrente

Due checkout provano l'ultimo utilizzo di un coupon. Verificare una sola redemption contabilizzata e totals finali corretti. Testare anche coupon scaduto al commit, cambio timezone e manipolazione sconto nel payload client. La policy deve dire se prezzo/sconto sono bloccati a quote, reservation o pagamento: il test non inventa la risposta.

### EC-06 — due rimborsi parziali e retry

Ordine con due righe, sconto ripartito e spedizione. Richiedere refund concorrenti che, sommati, superano il residuo; duplicare una richiesta; ritardare la notifica provider. Accettazione: nessun over-refund, stessa allocation in provider e ledger, stock rientrato solo con disposizione del reso prevista, credito restituito al tender corretto. Dopo restart rileggere stato e prova contabile; cancellare un record locale non annulla un refund esterno.

### EC-07 — abbandono, TTL e pagamento tardivo

Creare reservation, abbandonare, avanzare clock solo se ufficialmente supportato e aspettare rilascio. Consegnare successivamente un pagamento valido. Il sistema segue una policy esplicita: nuova allocazione oppure compensazione/refund, senza perdere denaro o promettere stock inesistente. Per l'oracolo non usare un clock simulato mentre provider e job scheduler usano un tempo diverso senza modellare lo scarto.

### EC-08 — accesso cross-customer e cross-role

Cliente A crea ordine; B tenta detail, invoice, cancel, refund e tracking con ID di A. Ripetere da guest link invalido/scaduto e account assistenza con ruolo insufficiente. Verificare denial, nessuna informazione sensibile e nessun side effect in DB/provider/queue. Vietare query read-only di verifica più privilegiate che contaminino la sessione dell'attaccante simulato.

### EC-09 — checkout usabile quando un servizio degrada

Carrier timeout, pagamento pending e notifica down testati separatamente. Verificare messaggio comprensibile, retry che non duplica, focus accessibile, stato non falsamente definitivo e recupero dopo refresh. Misurare il tempo dalla prima azione al risultato stabile, con budget concordato; testare mobile, tastiera e zoom. Un fallback di spedizione deve rispettare regole commerciali, non inventare spedizione gratuita.

### EC-10 — assistente AI non autorizzato a spendere

Inserire istruzioni malevole sintetiche in descrizione prodotto, recensione o tool response. L'assistente può cercare/spiegare, ma non cambiare prezzo, esfiltrare ordini, acquistare o rimborsare fuori policy. Conferma umana legata a cart revision, totale, valuta, destinatario e scadenza; modifica del carrello invalida l'approvazione. Verificare a livello tool gateway e stato persistito, non soltanto che il modello scriva un rifiuto. Nessuna auto-approvazione generata dall'agente.

## 8. Estensioni del journey engine necessarie

Da progettare nel core, riutilizzabili fuori dal commerce:

- **Capability preflight**: driver reali, observer, session isolation e fault richiesti; assenza => blocked/unsupported. Non avviare parte distruttiva prima della verifica.
- **Binding tipizzato**: estrarre un ID o token reference da uno step e usarlo nel successivo; path inesistente/ambiguo => errore. Niente `eval` o shell interpolation arbitraria.
- **Parallel group + barrier**: attori e interleaving espliciti; limite concurrency, timeout e cancellazione propagata a tutti i figli.
- **Temporal assertions**: `eventually` con deadline/poll bounded e `never` su finestra dichiarata; timeout => outcome motivato, mai assenza di finding come successo.
- **Domain observers**: API/database/provider con permessi minimi e timestamp/revision; read replica lag trattato esplicitamente.
- **Reference oracle**: libreria pura money/allocation/state transitions testata contro golden case approvati, indipendente dal calcolatore del SUT.
- **Durable cleanup**: finalizer anche dopo crash, ownership delle fixture, reconciliation job e residui visibili. Le compensazioni non sono rollback atomico di una transazione distribuita.
- **Artifact provenance**: codice SUT, pack, policy, fixture manifest, provider mode, seed, timeline e digest osservazioni; mascheramento prima della scrittura.

Versionare lo schema nuovo e migrare i pack esistenti con verifica semantica. Un file accettato sintatticamente ma ignorato in parte deve essere rifiutato o segnalato come incompatibile.

## 9. Sicurezza operativa: non fare danni mentre si fa QA

Default: sviluppo/staging isolato, identità sintetiche, gateway sandbox, mail/SMS sink, fulfillment disabilitato o sandbox. La documentazione Shopify ricorda che un ordine di test riguarda anche inventory, shipping, notifiche e imposte: il solo gateway simulato non dimostra isolamento degli altri effetti. [Shopify test orders](https://help.shopify.com/en/manual/checkout-settings/test-orders).

Classificare azioni come read-only, synthetic-write, financial-side-effect e destructive-fault. Approvazione esplicita vincolata a ambiente, merchant, scopo, importo/valuta massimi, numero ordini e scadenza. Budget riservati atomicamente tra worker; kill switch impedisce nuovi effetti e riconcilia quelli già in corso, non finge di annullare una cattura completata.

Produzione: inizialmente solo osservazione read-only e synthetic journey limitati esplicitamente autorizzati. Niente refund, pagamento reale, carico o caos automaticamente perché un pack li contiene. Vietare invio a clienti, spedizioni, marketing e analytics reali. Una canary con acquisto vero richiederebbe un workflow distinto, approvato e contabilmente riconciliato: non è inclusa nella proposta iniziale.

Non memorizzare dati carta, token, cookie o payload sensibili negli artefatti. Screenshot e trace browser richiedono redazione o esclusione preventiva delle superfici sensibili, non solo una regex sul report finale. Le evidenze insufficienti per ragioni di privacy restano dichiarate come tali.

## 10. Prestazioni, capacità e affidabilità del toolkit

Non assumere che 1.000 browser equivalgano a un test necessario. Definire profili distinti: smoke per PR, journey critici pre-release, race suite in staging dedicato, soak autorizzato. Capacity planning da misure: concorrenza media approssimata da arrival rate × durata media, headroom concordato e limiti provider. Separare carico API da copertura UI; browser solo dove aggiunge una prova.

Queue con lease/fencing e checkpoint; un worker riavviato riconcilia prima di ripetere una operazione finanziaria. Consegna task almeno-una-volta non dà effetti exactly-once: servono idempotenza e dedup applicative. Evidenze bounded, backpressure e TTL artefatti; retention e cancellazione specifiche per merchant.

Metriche toolkit: false-green rate su SUT mutanti, ripetibilità del finding, unknown/unsupported rate, latenza verdetto, costo per journey, residui cleanup, tempo riconciliazione. Metriche SUT: checkout completion, duplicate effects, oversell, payment-order mismatch, pending fuori SLA, refund discrepancies. Tenere separate le due famiglie: un provider di test down non è automaticamente un difetto del merchant.

## 11. Esperienza utente proposta

Wizard di onboarding: merchant/environment → capability discovery read-only → policy e perimetro → fixture sandbox → primo journey verificato. Mostrare prima cosa verrà scritto e quali side effect sono possibili.

Vista principale commerce: matrice rischio × journey × fonte di prova; stati distinti pass/fail/error/unknown/unsupported. Per un ordine sintetico mostrare timeline correlata browser/API/payment/inventory/notification con links a evidenza redatta. Il fatto che una fonte non sia accessibile deve essere evidente, non nascosto dietro un badge verde.

Finding con “atteso / osservato / conseguenza business / ambiente / riproduzione / prove mancanti”; esempio: “retry dopo timeout ha creato due catture”, non “HTTP 200 anomalo”. Il costo potenziale è un'ipotesi esplicita, non un danno economico inventato.

Self-healing dei locator produce una proposta versionata: vietato eliminare assertion, ridurre importi, aumentare deadline o saltare la challenge per far tornare verde il checkout.

## 12. Milestone proposte e gate

1. **Fondamenta**: chiudere falsi verdi, outcome/report, ID/persistenza, auth/tenant, packaging e driver necessari dalla review. Gate: SUT difettosi rilevati, capability assente mai pass.
2. **Commerce pilot**: adapter reference + merchant scelto; EC-01, EC-02, EC-03, EC-08 con dati sintetici. Gate: UI → API → stato autorevole → nuova sessione e restart dove controllabile; evidenze provider sandbox distinte dalle simulazioni.
3. **Distributed integrity**: EC-04–EC-07, queue recovery, cleanup durevole, riconciliazione. Gate: duplicazioni/crash/riordino non producono effetti extra; anomalie deliberate rilevate.
4. **Experience and operations**: EC-09, accessibilità manuale mirata, profili performance, dashboard prove e runbook residui. Gate: degrado comprensibile, recupero verificato, budget rispettati.
5. **Agentic commerce + estensioni business**: EC-10 e solo i moduli richiesti da pilot reali. Gate: approval binding e tool authorization resistono a injection e TOCTOU.

Ogni milestone richiede test di contratto adapter e test mutanti: doppia cattura, stock decrementato due volte, firma webhook ignorata, ordine di altro cliente leggibile, refund in eccesso e UI che dice successo su pagamento pending. Il toolkit deve fallire contro quei SUT difettosi, passare sul riferimento corretto e distinguere ambiente non disponibile da bug.

Prima dell'implementazione vanno confermati: piattaforma del primo pilot, sandbox pagamento disponibile, modalità beni/pagamenti, accesso agli osservatori, ambiente autorizzato e regole monetarie. Non serve bloccare questa proposta per ottenere tali dettagli; servono invece per promuoverla a specifica esecutiva approvata.

## 13. Differenziazione difendibile

Il vantaggio potenziale non è “l'AI clicca compra”. È un **commerce assurance case**: per ogni release collegare rischio economico, comportamento, prove indipendenti, fault esercitati e limiti rimasti. L'agente può esplorare; il verdetto sulle invarianti resta verificabile.

Dimostrarlo con benchmark su corpus versionato: checkout corretto più varianti con difetti seminati, stesso budget di tempo/costo e identiche integrazioni per ogni baseline. Misurare difetti rilevati, falsi verdi, falsi positivi, tempo umano e riproducibilità. Nessuna affermazione di superiorità sul mercato prima di queste misure.
