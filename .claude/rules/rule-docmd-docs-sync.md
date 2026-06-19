# Keep docmd Docs in Sync

When a change affects public usage, architecture, CLI behavior, API contracts, or operational workflow, update `docs-site/docs` in the same change.

Required checks:

- every Markdown page appears in `docs-site/docmd.config.json` navigation;
- docs remain Markdown-only with no raw HTML;
- `npm run check` passes;
- `npm run build` regenerates `_site` without leaked `:::` markers.
