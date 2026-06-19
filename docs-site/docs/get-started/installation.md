---
title: Installation
description: Runtime, package, and authentication requirements.
---

# Installation

The repository is Bun-first and supports Node fallback where package scripts require it.

::: callout info "Package registry" icon:package
The package is published as `@padosoft/agentic-qa-kit` through GitHub Packages. Public packages still require a token for installation from that registry.
:::

## Requirements

- Bun 1.3 or newer for workspace scripts.
- Node 22 or newer for the project runtime.
- GitHub token with `read:packages` when installing from GitHub Packages.

## Registry setup

```ini
@padosoft:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

## Verify install

```bash
bunx aqa doctor
bunx aqa validate
```

The doctor command checks that `.aqa/` exists, profiles load, packs resolve, and the project is ready for a run.
