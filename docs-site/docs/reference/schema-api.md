---
title: Schema API
description: Shared schema package reference.
---

# Schema API

`packages/schemas` is the source for shared runtime contracts.

## Schema families

- common identifiers and severity values;
- project and tenancy metadata;
- risk and scenario definitions;
- event and audit records;
- findings and reports;
- cost summaries;
- agents and API tokens;
- SSO configuration.

::: callout tip "Use schemas at boundaries" icon:braces
Validate input at CLI, server, runner, and pack boundaries. Internal helper functions can use typed values after validation.
:::

## Versioning guidance

Schema changes should be backward compatible unless the release explicitly announces a migration. Prefer additive fields with defaults over renaming fields in place.
