import type { PackManifest } from '@aqa/schemas';

export interface ScanIssue {
  severity: 'critical' | 'high' | 'medium' | 'low';
  rule: string;
  message: string;
}

export interface ScanResult {
  ok: boolean;
  issues: readonly ScanIssue[];
}

const DESTRUCTIVE_PROBE_KINDS = new Set(['shell']);

/**
 * Static checks against a pack manifest:
 *
 * - critical: pack ships destructive probe templates without `signing.sha256`.
 * - high: pack declares `applies_when: {}` (always-on) AND ships shell probes
 *   — universally-applied + arbitrary command execution is a supply-chain
 *   anti-pattern.
 * - medium: pack version is < 1.0.0 but `signing.sigstore_bundle` is set —
 *   signing pre-1.0 packs is unusual; surface for review.
 * - low: pack ships templates but no risks (templates-only packs are valid
 *   but uncommon; flag for visibility).
 *
 * This is intentionally narrow at v0.3; the full ruleset lands with v0.4
 * once the marketplace + community-pack story crystallises.
 */
export function scanPack(manifest: PackManifest.PackManifest): ScanResult {
  const issues: ScanIssue[] = [];
  const probesByName = new Set(manifest.probes);
  const hasShellProbe = manifest.probes.some((p) => /shell/i.test(p));
  const isAlwaysOn = Object.keys(manifest.applies_when).length === 0;

  if (hasShellProbe && !manifest.signing?.sha256) {
    issues.push({
      severity: 'critical',
      rule: 'unsigned-shell-pack',
      message:
        'Pack ships shell-kind probes but is unsigned. Refusing to install in non-dev profiles.',
    });
  }
  if (hasShellProbe && isAlwaysOn) {
    issues.push({
      severity: 'high',
      rule: 'always-on-shell-pack',
      message:
        'Pack has `applies_when: {}` (always installed) AND ships shell probes — high-blast-radius supply-chain risk.',
    });
  }
  // Touch the set so the compiler does not warn unused; semantically it
  // would feed deeper template static analysis in v0.4.
  void probesByName;
  void DESTRUCTIVE_PROBE_KINDS;
  const version = manifest.version;
  const isPreOneZero = /^0\./.test(version);
  if (isPreOneZero && manifest.signing?.sigstore_bundle) {
    issues.push({
      severity: 'medium',
      rule: 'signed-pre-1.0',
      message: `Pack version ${version} is pre-1.0 but ships a sigstore bundle. Confirm the signing pipeline is set up intentionally.`,
    });
  }
  if (manifest.templates.length > 0 && manifest.risks.length === 0) {
    issues.push({
      severity: 'low',
      rule: 'templates-without-risks',
      message: 'Pack ships templates but does not contribute risks. Confirm this is intentional.',
    });
  }
  return { ok: issues.every((i) => i.severity === 'low'), issues };
}
