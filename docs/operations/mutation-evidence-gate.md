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

For a producer that also publishes observed regression executions, provide the
optional `regression_artifact`, `regression_file` and
`min_regression_kill_rate` inputs. The protected workflow then additionally
runs:

```text
aqa mutation regression <report.json> <manifest.json> <evidence.json> \
  --min-kill-rate X
```

This second gate requires one bounded observation for every reviewed
mutant/scenario pair and checks that observed outcomes agree with the mutation
report and that `source_revision` equals the protected workflow's commit SHA.
Leaving the optional artifact unset preserves compatibility with
existing producers, but does not claim execution evidence.

The log contains only bounded IDs and rates and is retained as a short-lived
workflow artifact. The workflow being present is not evidence of a mutation
run. An operator must configure the producer, environment protection and
artifact retention policy, then record the completed run URL and source/tool
provenance outside Git.
