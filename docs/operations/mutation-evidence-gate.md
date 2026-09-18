# Protected mutation evidence gate

The reusable `.github/workflows/mutation-evidence-gate.yml` workflow verifies
an external mutation producer without executing arbitrary project commands in
the AQA gate. A caller must first run Stryker, mutmut or an equivalent tool in
its own bounded job, upload the report and upload a reviewed manifest linking
each evaluated mutant to risk and regression scenario IDs.

The gate runs in the protected `methodology-mutation-evidence` Environment,
checks artifact-relative paths, builds the pinned workspace and invokes:

```text
aqa mutation coverage <report.json> <manifest.json> \
  --min-mapped-rate X --min-killed-rate Y
```

The log contains only bounded IDs and rates and is retained as a short-lived
workflow artifact. The workflow being present is not evidence of a mutation
run. An operator must configure the producer, environment protection and
artifact retention policy, then record the completed run URL and source/tool
provenance outside Git.
