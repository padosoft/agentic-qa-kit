# `pack-data-pipeline`

Opt-in contracts for ETL/ELT and streaming pipelines: schema compatibility,
data quality gates, freshness and replay-safe processing.

## Use it

Tag a project with `data-pipeline`, `etl`, `elt`, `airflow`, `dbt` or `streaming`
and install the pack through the normal `aqa` pack workflow.

## Evidence boundary

The pack is provider-neutral and does not run Airflow, dbt, a schema registry or
a warehouse by itself. It does not certify lineage, freshness, governance,
privacy, exactly-once delivery or production recovery. Bind the contracts to a
disposable pipeline, real contract registry and bounded non-production fixtures;
record provider-specific lineage, access-control, backfill and restore evidence
separately.
