# ADR-170: Every agent adapter renders the canonical bootstrap

## Context

Claude, Gemini and Copilot instruction files delegate to `AGENTS.md`. A
single-target installation previously emitted only the target file and its
skills, leaving the canonical rules absent and making the generated setup
internally inconsistent.

## Decision

Every adapter renders `AGENTS.md` alongside its target-specific instruction
file. The Codex adapter already did this; Claude, Gemini and Copilot now use
the same shared renderer. The installer remains responsible for its existing
overwrite/merge policy.

## Evidence and boundary

Adapter tests verify the canonical file for every target and the
interoperable `SKILL.md` shape. This proves generated file consistency, not
that every released host version discovers or executes a skill; host-version
installation journeys remain operational evidence.
