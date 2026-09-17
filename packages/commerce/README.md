# `@aqa/commerce`

Typed commerce-assurance contracts used by Agentic QA Kit merchant adapters and journeys.

## Table of contents

- [Features](#features)
- [Setup](#setup)

## Features

- Decimal-safe `Money` values using ISO currency plus integer minor units.
- Versioned tenant/run context and order, payment, inventory snapshots.
- Explicit `pass`, `fail`, `blocked`, `unsupported`, and `inconclusive` outcomes.
- Fail-closed currency and inventory invariants.

## Setup

From the repository root:

```bash
bun install
bun run --filter @aqa/commerce build
bun test packages/commerce/test/contracts.test.ts
```

Use this package for contracts only. Merchant and payment adapters must provide authoritative observations; an unavailable observer is `unsupported`, never an empty success.
