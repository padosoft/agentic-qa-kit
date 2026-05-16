# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Task 1 in progress: schemas package + core types.

## [0.0.1-governance] — 2026-05-17

### Added — Bootstrap (Task 0)

- Process governance docs: `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`.
- `docs/RULES.md` (UI/UX, security, testing, doc, review, code style, git workflow).
- `docs/PROGRESS.md` and `docs/LESSON.md` templates.
- `docs/adr/README.md` with ADR template and index of 10 critical ADRs.
- `docs/design/admin-panel-template.md` — complete admin UI spec for parallel template work.
- `docs/getting-started.md` — junior-friendly onboarding skeleton.
- `docs/ecosystem-explained.md` — concept introduction skeleton.
- Skills: `.agents/skills/aqa-process-loop`, `.agents/skills/aqa-self-resume` (mirrored to `.claude/`, `.gemini/`, `.github/`).
- Repo scaffolding: `package.json` (Bun workspaces), `tsconfig.base.json`, `biome.json`, `bunfig.toml`, `.editorconfig`, `.gitignore`, `.gitattributes`, `.nvmrc`, `.bun-version`.
- CI: `.github/workflows/ci.yml` (typecheck + lint + unit + node-compat + build + e2e gates).
- Copilot review automation: `.github/workflows/copilot-review.yml` (with GraphQL fallback).
- GitHub templates: `CODEOWNERS`, `pull_request_template.md`, `ISSUE_TEMPLATE/{bug,feature,security}.yml`.
- `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`.
- `README.md` rewritten with enterprise badges, TOC, features, quick start.

[Unreleased]: https://github.com/padosoft/agentic-qa-kit/compare/v0.0.1-governance...HEAD
[0.0.1-governance]: https://github.com/padosoft/agentic-qa-kit/releases/tag/v0.0.1-governance
