# ADR-172: Derive air-gap image tags from the chart application version

## Context

The air-gap bundle contains the Helm chart and server/runner image tarballs.
Hard-coded image tags can drift from `deploy/helm/Chart.yaml`, producing a
bundle whose chart and images do not describe the same release.

## Decision

`air-gap-install.sh bundle` reads the chart `appVersion` and derives both
server and runner image references from it. The bundle operation fails closed
when `appVersion` is missing instead of silently selecting a stale version.
The install path continues to require at least one image tarball and verifies
the content manifest before loading images or invoking Helm.

## Evidence and boundary

CI shell syntax validation and the existing Helm render job remain required.
This removes repository-local version drift; it does not prove that the
registry publishes both images, that their digests match the chart release, or
that a real air-gapped cluster completes upgrade/rollback.
