# docmd-docs

Use this skill when changing the `docs-site` documentation.

## Rules

- Keep documentation source in `docs-site/docs`.
- Write Markdown only. Do not use MDX, JSX, or raw HTML.
- Use docmd containers for rich layout: `callout`, `tabs`, `steps`, `collapsible`, `grids`, `grid`, and `card`.
- Do not use `::: button`.
- Keep `docs-site/docmd.config.json` navigation in sync with every page.
- Run `npm run check` and `npm run build` before finishing.
- Confirm `_site/index.html`, `_site/llms.txt`, `_site/sitemap.xml`, and `_site/.docmd-search/manifest.json` exist after build.
