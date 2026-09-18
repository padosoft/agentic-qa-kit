# ADR-265: Fail-closed oracle calibration CLI

## Decision

Expose `aqa oracle calibrate <corpus.json>` as the operational entry point for
calibrating opaque judge probabilities against a reviewed gold corpus. The
command computes Brier score, reliability bins and expected calibration error
(ECE), and returns exit code 2 when `--max-ece` is exceeded.

## Safety and provenance

The corpus schema is versioned, bounded to 100,000 samples, rejects unknown
fields and stores only sample IDs, probabilities and human-reviewed labels.
Private judge rationales are not accepted. The command does not invoke an LLM,
close findings or make a release decision without the explicit threshold.

## Boundary

Calibration metrics are evidence about a supplied gold corpus. They do not
prove the corpus is unbiased or replace human governance, model diversity,
prompt/version provenance or periodic recalibration.
