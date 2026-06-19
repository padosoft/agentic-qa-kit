---
title: Motivazione
description: Why coding agents need an explicit QA operating model.
---

# Motivazione

Coding agents are strong at producing code and weak at deciding what must never break. Without explicit QA structure, they optimize for task completion instead of adversarial exploration, reproducible evidence, and release risk.

`agentic-qa-kit` gives agents a stable operating frame:

- risks define what matters;
- invariants define unacceptable behavior;
- scenarios make exploration concrete;
- probes perform the experiment;
- oracles decide pass or fail;
- findings preserve evidence;
- replay makes the failure actionable.

::: callout warning "The kit is not a test runner" icon:triangle-alert
It coordinates agentic QA work. It can call tests, probes, and scripts, but its core value is the risk-to-replay contract.
:::

## Why this is different

A normal test suite is usually bounded by known expected behavior. Agentic QA starts from risk and asks what can go wrong near the edges of the system.
