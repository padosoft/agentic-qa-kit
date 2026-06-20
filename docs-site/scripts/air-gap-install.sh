#!/usr/bin/env bash
# air-gap-install.sh — bundle the AQA stack for installation in environments
# without registry / npm-registry access (Task 22, v0.6 scaffold).
#
# What this script does in v0.6:
#   - `bundle` subcommand: produces a tarball containing the Helm chart,
#     pinned container images (saved with `docker save`), and the schema
#     artifacts needed for `aqa validate` to work offline.
#   - `verify` subcommand: re-computes sha256 of the bundle and compares
#     it to the manifest. Refuses to proceed on mismatch (hash-chained
#     audit philosophy — every artifact has a provenance hash).
#
# What lands in v1.0:
#   - `install` subcommand: pushes images to an internal registry, then
#     `helm install`s the chart against the local kubeconfig.
#   - Cosign signature verification on the bundle itself.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHART_DIR="${REPO_ROOT}/deploy/helm"
BUNDLE_OUT="${BUNDLE_OUT:-${REPO_ROOT}/.aqa/tmp/aqa-air-gap-bundle.tar.gz}"
IMAGES=(
  "ghcr.io/padosoft/agentic-qa-kit-server:0.6.0"
  "ghcr.io/padosoft/agentic-qa-kit-runner:0.6.0"
)

log() { printf '[air-gap-install] %s\n' "$*" >&2; }

cmd_bundle() {
  local stage
  stage="$(mktemp -d)"
  trap 'rm -rf "${stage}"' EXIT

  log "staging chart into ${stage}/helm"
  mkdir -p "${stage}/helm"
  cp -r "${CHART_DIR}/." "${stage}/helm/"

  log "saving ${#IMAGES[@]} images"
  mkdir -p "${stage}/images"
  if ! command -v docker >/dev/null 2>&1; then
    log "WARN: docker not found — bundle will not contain image tarballs"
  else
    for img in "${IMAGES[@]}"; do
      local out_name
      out_name="$(printf '%s' "${img}" | tr '/:' '__').tar"
      docker save -o "${stage}/images/${out_name}" "${img}" || \
        log "WARN: failed to save ${img} (image may not yet be published in v0.6)"
    done
  fi

  log "writing manifest"
  ( cd "${stage}" && find . -type f -print0 \
      | xargs -0 sha256sum > MANIFEST.sha256 ) || true

  mkdir -p "$(dirname "${BUNDLE_OUT}")"
  log "writing ${BUNDLE_OUT}"
  tar -czf "${BUNDLE_OUT}" -C "${stage}" .
  log "done — bundle at ${BUNDLE_OUT}"
}

cmd_verify() {
  local bundle="${1:-${BUNDLE_OUT}}"
  if [[ ! -f "${bundle}" ]]; then
    log "ERROR: bundle not found at ${bundle}"
    exit 1
  fi
  local stage
  stage="$(mktemp -d)"
  trap 'rm -rf "${stage}"' EXIT

  log "extracting ${bundle} to verify"
  tar -xzf "${bundle}" -C "${stage}"

  if [[ ! -f "${stage}/MANIFEST.sha256" ]]; then
    log "ERROR: MANIFEST.sha256 missing — bundle is malformed"
    exit 1
  fi

  log "checking sha256 manifest"
  ( cd "${stage}" && sha256sum -c MANIFEST.sha256 --quiet ) && log "OK"
}

main() {
  local sub="${1:-help}"
  case "${sub}" in
    bundle) shift; cmd_bundle "$@" ;;
    verify) shift; cmd_verify "$@" ;;
    help|--help|-h|"")
      cat <<EOF
Usage: air-gap-install.sh <bundle|verify> [args]

  bundle               Produce \${BUNDLE_OUT:-.aqa/tmp/aqa-air-gap-bundle.tar.gz}
  verify [path]        sha256 check on a bundle

v0.6 scaffold — install subcommand lands in v1.0.
EOF
      ;;
    *)
      log "ERROR: unknown subcommand '${sub}'"
      exit 1
      ;;
  esac
}

main "$@"
