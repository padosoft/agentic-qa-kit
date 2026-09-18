# ADR-199: S3 retention verification key boundary

## Status

Accepted

## Context

`S3ArtifactStore` normalizes logical artifact keys by applying its configured
prefix. The retention helper was also normalizing its input, while the caller
passed the already-prefixed metadata key. This produced a double prefix and
could validate a different object from the one written.

## Decision

`assertRetention()` accepts a fully qualified provider object key and sends it
unchanged to `HeadObject`. The write path explicitly qualifies both the data
object and `.meta.json` object before invoking the helper. Tests assert both
provider keys when a prefix and retention verification are enabled.

## Consequences

Retention evidence now covers the exact immutable objects used by reads and
metadata lookup. Future storage backends must make the logical-key/provider-key
boundary explicit in their helpers and test data plus metadata paths together.
