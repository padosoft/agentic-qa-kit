---
title: Teoria
description: The theoretical model behind risk, probes, oracles, and replay.
---

# Teoria

The core loop is a mapping from declared risk to reproducible evidence.

$$
Finding = Oracle(Probe(Scenario(Invariant(Risk))))
$$

The useful quality signal is not the volume of generated scenarios. It is the ratio of verified findings to total explored risk surface.

$$
Q = \frac{F_v}{R_e + C}
$$

Where `F_v` is verified findings, `R_e` is explored risk area, and `C` is execution cost.

::: callout tip "Optimize for evidence" icon:check-circle
Better QA runs reduce ambiguity. They do not merely produce more prose.
:::

## Practical implications

- A high-severity risk with no invariant is underspecified.
- A scenario with no oracle is exploration, not verification.
- A finding with no replay is a lead, not a release-gate blocker.
