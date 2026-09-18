# Commerce provider evidence

The repository contains a manual, read-only live journey for a gift-card
issuer. It verifies the complete boundary that can be proven without mutating
merchant or issuer state:

1. authenticate to the operator-selected provider endpoint;
2. bind the request to the configured tenant and card ID;
3. parse the bounded, versioned provider observation;
4. reconcile provider identity, currency, balance, status and expiry against a
   merchant ledger projection; and
5. fail closed on transport, schema, temporal or reconciliation drift.

Run `.github/workflows/gift-card-provider-evidence.yml` manually from GitHub.
It uses the protected `commerce-provider-evidence` Environment. The workflow
fails before the test if the required non-secret Environment variables are
missing; it never invents a fixture or turns an unconfigured provider into a
pass.

Configure these Environment variables:

- `AQA_TEST_GIFT_CARD_PROVIDER_URL` — HTTPS issuer base URL;
- `AQA_TEST_GIFT_CARD_TENANT` — tenant owned by the evidence account;
- `AQA_TEST_GIFT_CARD_ID` — pre-created, non-production test card;
- `AQA_TEST_GIFT_CARD_BALANCE_CURRENCY` and
  `AQA_TEST_GIFT_CARD_BALANCE_MINOR` — merchant-authoritative expected balance;
- `AQA_TEST_GIFT_CARD_EXPECTED_STATUS` — `active`, `expired` or `blocked`;
- optional `AQA_TEST_GIFT_CARD_ALLOWED_ORIGINS`, `AQA_TEST_GIFT_CARD_PATH`
  and `AQA_TEST_GIFT_CARD_NOW`.

If the issuer requires an authorization header, configure the complete header
value (for example `Bearer …`) only as the Environment secret
`AQA_TEST_GIFT_CARD_AUTHORIZATION`. It is injected at request time and is not
written to logs, evidence or the repository.

This journey is intentionally read-only. It does not prove issuer-side issue,
redemption, settlement, token rotation, IAM, availability or disaster
recovery. Those require separate provider-owned exercises and evidence.
