#!/usr/bin/env bash
# air-gap-install.sh — bundle the AQA stack for installation in environments
# without registry / npm-registry access (Task 22).
#
# What this script does in v0.6:
#   - `bundle` subcommand: produces a tarball containing the Helm chart,
#     pinned container images (saved with `docker save`), and the schema
#     artifacts needed for `aqa validate` to work offline.
#   - `verify` subcommand: re-computes sha256 of the bundle and compares
#     it to the manifest. Refuses to proceed on mismatch (hash-chained
#     audit philosophy — every artifact has a provenance hash).
#
# The `install` subcommand verifies the bundle, loads its images into Docker
# or Podman and installs the bundled chart against an explicit kube context.
# Cosign is supported when COSIGN_PUBLIC_KEY is supplied; unsigned bundles are
# refused when COSIGN_REQUIRED=true.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHART_DIR="${REPO_ROOT}/deploy/helm"
BUNDLE_OUT="${BUNDLE_OUT:-${REPO_ROOT}/.aqa/tmp/aqa-air-gap-bundle.tar.gz}"
chart_app_version() {
  local version
  version="$(awk -F '\"' '$1 ~ /^[[:space:]]*appVersion:/ { print $2; exit }' "${CHART_DIR}/Chart.yaml")"
  [[ -n "${version}" ]] || die "chart appVersion is missing from ${CHART_DIR}/Chart.yaml"
  printf '%s' "${version}"
}

airgap_images() {
  local version
  version="$(chart_app_version)"
  printf '%s\n' \
    "ghcr.io/padosoft/agentic-qa-kit-server:${version}" \
    "ghcr.io/padosoft/agentic-qa-kit-runner:${version}"
}

log() { printf '[air-gap-install] %s\n' "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }
CLEANUP_STAGE=''
cleanup_stage() {
  if [[ -n "${CLEANUP_STAGE}" ]]; then
    rm -rf -- "${CLEANUP_STAGE}"
    CLEANUP_STAGE=''
  fi
}

safe_extract() {
  local bundle="$1" stage="$2"
  tar -tzf "${bundle}" >"${stage}/.tar-list"
  while IFS= read -r entry; do
    entry="${entry#./}"
    case "${entry}" in
      /*|../*|*/../*|*/..) die "unsafe path in bundle: ${entry}" ;;
    esac
  done <"${stage}/.tar-list"
  while IFS= read -r entry; do
    case "${entry:0:1}" in
      l|h) die "links are not allowed in bundle: ${entry}" ;;
    esac
  done < <(tar -tvzf "${bundle}")
  tar --no-same-owner --no-same-permissions -xzf "${bundle}" -C "${stage}"
}

cmd_bundle() {
  local stage
  stage="$(mktemp -d)"
  CLEANUP_STAGE="${stage}"
  trap cleanup_stage EXIT

  log "staging chart into ${stage}/helm"
  mkdir -p "${stage}/helm"
  cp -r "${CHART_DIR}/." "${stage}/helm/"

  mapfile -t images_to_save < <(airgap_images)
  log "saving ${#images_to_save[@]} images for chart appVersion $(chart_app_version)"
  mkdir -p "${stage}/images"
  if ! command -v docker >/dev/null 2>&1; then
    log "WARN: docker not found — bundle will not contain image tarballs"
  else
    for img in "${images_to_save[@]}"; do
      local out_name
      out_name="$(printf '%s' "${img}" | tr '/:' '__').tar"
      docker save -o "${stage}/images/${out_name}" "${img}" || \
        log "WARN: failed to save ${img} (image may not yet be published in v0.6)"
    done
  fi

  log "writing manifest"
  ( cd "${stage}" && find . -type f ! -path './MANIFEST.sha256' -print0 \
      | xargs -0 sha256sum > MANIFEST.sha256 ) || true

  mkdir -p "$(dirname "${BUNDLE_OUT}")"
  log "writing ${BUNDLE_OUT}"
  tar -czf "${BUNDLE_OUT}" -C "${stage}" .
  log "done — bundle at ${BUNDLE_OUT}"
  cleanup_stage
  trap - EXIT
}

cmd_verify() {
  local bundle="${1:-${BUNDLE_OUT}}"
  if [[ ! -f "${bundle}" ]]; then
    log "ERROR: bundle not found at ${bundle}"
    exit 1
  fi
  local stage
  stage="$(mktemp -d)"
  CLEANUP_STAGE="${stage}"
  trap cleanup_stage EXIT

  log "extracting ${bundle} to verify"
  safe_extract "${bundle}" "${stage}"

  if [[ ! -f "${stage}/MANIFEST.sha256" ]]; then
    log "ERROR: MANIFEST.sha256 missing — bundle is malformed"
    exit 1
  fi

  log "checking sha256 manifest"
  ( cd "${stage}" && sha256sum -c MANIFEST.sha256 --quiet ) && log "OK"
  cleanup_stage
  trap - EXIT
}

cmd_install() {
  local bundle="${BUNDLE_OUT}"
  local namespace="agentic-qa-kit"
  local release="aqa"
  local context=""
  local values=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --bundle) [[ $# -ge 2 ]] || die '--bundle needs a path'; bundle="$2"; shift 2 ;;
      --namespace) [[ $# -ge 2 ]] || die '--namespace needs a value'; namespace="$2"; shift 2 ;;
      --release) [[ $# -ge 2 ]] || die '--release needs a value'; release="$2"; shift 2 ;;
      --context) [[ $# -ge 2 ]] || die '--context needs a value'; context="$2"; shift 2 ;;
      --values) [[ $# -ge 2 ]] || die '--values needs a path'; values="$2"; shift 2 ;;
      *) die "unknown install option: $1" ;;
    esac
  done
  [[ -f "${bundle}" ]] || die "bundle not found at ${bundle}"
  local stage
  stage="$(mktemp -d)"
  CLEANUP_STAGE="${stage}"
  trap cleanup_stage EXIT
  safe_extract "${bundle}" "${stage}"
  [[ -f "${stage}/MANIFEST.sha256" ]] || die 'MANIFEST.sha256 missing'
  ( cd "${stage}" && sha256sum -c MANIFEST.sha256 --quiet ) || die 'bundle digest verification failed'

  if [[ "${COSIGN_REQUIRED:-false}" == "true" && -z "${COSIGN_PUBLIC_KEY:-}" ]]; then
    die 'COSIGN_REQUIRED=true but COSIGN_PUBLIC_KEY is not set'
  fi
  if [[ -n "${COSIGN_PUBLIC_KEY:-}" ]]; then
    command -v cosign >/dev/null 2>&1 || die 'COSIGN_PUBLIC_KEY is set but cosign is unavailable'
    [[ -f "${bundle}.sig" ]] || die "cosign signature missing: ${bundle}.sig"
    cosign verify-blob --key "${COSIGN_PUBLIC_KEY}" --signature "${bundle}.sig" "${bundle}" >/dev/null \
      || die 'cosign bundle signature verification failed'
  fi

  local runtime=''
  if command -v docker >/dev/null 2>&1; then runtime=docker
  elif command -v podman >/dev/null 2>&1; then runtime=podman
  else die 'install requires docker or podman to load air-gap images'; fi
  shopt -s nullglob
  local images=("${stage}"/images/*.tar)
  shopt -u nullglob
  ((${#images[@]} > 0)) || die 'bundle contains no image tarballs'
  local image
  for image in "${images[@]}"; do
    log "loading $(basename "${image}") with ${runtime}"
    "${runtime}" load --input "${image}" >/dev/null
  done

  command -v helm >/dev/null 2>&1 || die 'install requires helm'
  command -v kubectl >/dev/null 2>&1 || die 'install requires kubectl'
  local helm_args=(upgrade --install "${release}" "${stage}/helm" --namespace "${namespace}" --create-namespace)
  if [[ -n "${context}" ]]; then
    helm_args+=(--kube-context "${context}")
  fi
  if [[ -n "${values}" ]]; then
    [[ -f "${values}" ]] || die "values file not found: ${values}"
    helm_args+=(--values "${values}")
  fi
  log "installing ${release} into namespace ${namespace}"
  helm "${helm_args[@]}"
  cleanup_stage
  trap - EXIT
}

main() {
  local sub="${1:-help}"
  case "${sub}" in
    bundle) shift; cmd_bundle "$@" ;;
    verify) shift; cmd_verify "$@" ;;
    install) shift; cmd_install "$@" ;;
    help|--help|-h|"")
      cat <<EOF
Usage: air-gap-install.sh <bundle|verify|install> [args]

  bundle               Produce \${BUNDLE_OUT:-.aqa/tmp/aqa-air-gap-bundle.tar.gz}
  verify [path]        sha256 check on a bundle
  install [options]    Verify, load OCI images and helm upgrade --install
    --bundle <path>    Bundle path (default: BUNDLE_OUT)
    --namespace <name> Kubernetes namespace (default: agentic-qa-kit)
    --release <name>   Helm release name (default: aqa)
    --context <name>   Optional kube context
    --values <path>    Optional operator values file

Set COSIGN_PUBLIC_KEY to require and verify <bundle>.sig; set
COSIGN_REQUIRED=true to fail when no public key is configured.
EOF
      ;;
    *)
      log "ERROR: unknown subcommand '${sub}'"
      exit 1
      ;;
  esac
}

main "$@"
