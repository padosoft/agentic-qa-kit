---
title: CI and Governance
description: Run AQA in pull requests and release workflows.
---

# CI and Governance

CI should run a bounded profile, archive reports, and fail only on policy-backed findings.

```bash
bunx aqa validate
bunx aqa run --profile release-gate
bunx aqa report --format json
```

## Governance controls

- Budget caps per profile.
- Hash-chained audit events.
- Replay artifacts for verified findings.
- Pack signing and scanning before shared use.
- Copilot Code Review and documented PR loops.

::: callout info "Audit trail" icon:file-check
The audit log is useful only if CI stores it with the same retention policy as release evidence.
:::
