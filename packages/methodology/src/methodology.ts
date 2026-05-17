import type { RiskMap } from '@aqa/schemas';

export type StrideCategory =
  | 'Spoofing'
  | 'Tampering'
  | 'Repudiation'
  | 'InformationDisclosure'
  | 'DenialOfService'
  | 'ElevationOfPrivilege';

const RISK_CATEGORY_TO_STRIDE: Record<RiskMap.Risk['category'], StrideCategory[]> = {
  auth: ['Spoofing', 'ElevationOfPrivilege'],
  data: ['Tampering', 'InformationDisclosure'],
  integrity: ['Tampering'],
  availability: ['DenialOfService'],
  confidentiality: ['InformationDisclosure'],
  integration: ['Tampering', 'DenialOfService'],
  business_logic: ['ElevationOfPrivilege', 'Repudiation'],
  ui_ux: [],
  compliance: ['Repudiation'],
  agentic: ['ElevationOfPrivilege', 'InformationDisclosure'],
};

export function strideOf(risk: RiskMap.Risk): StrideCategory[] {
  return [...RISK_CATEGORY_TO_STRIDE[risk.category]];
}

/**
 * FMEA Risk Priority Number = severity * occurrence * detection.
 *
 * - severity maps 1 (info) … 5 (critical)
 * - occurrence maps 1 (rare) … 5 (almost_certain) from likelihood
 * - detection defaults to 3 (medium) — calibrated by historical false-positive
 *   rate in v0.7 when we have enough data.
 */
const SEV_TO_NUM: Record<RiskMap.Risk['severity'], number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

const LIKELIHOOD_TO_NUM: Record<RiskMap.Risk['likelihood'], number> = {
  almost_certain: 5,
  likely: 4,
  possible: 3,
  unlikely: 2,
  rare: 1,
};

export interface FmeaScore {
  severity: number;
  occurrence: number;
  detection: number;
  rpn: number;
}

export function fmeaScore(risk: RiskMap.Risk, detection = 3): FmeaScore {
  const severity = SEV_TO_NUM[risk.severity];
  const occurrence = LIKELIHOOD_TO_NUM[risk.likelihood];
  return { severity, occurrence, detection, rpn: severity * occurrence * detection };
}

/**
 * Extract the OWASP mapping from the risk's tag list. Tags like
 * `owasp:a07`, `owasp-agentic:a01` are recognised.
 */
export function owaspOf(risk: RiskMap.Risk): { web: string[]; agentic: string[] } {
  const web: string[] = [];
  const agentic: string[] = [];
  for (const tag of risk.tags) {
    if (tag.startsWith('owasp-agentic:')) agentic.push(tag.replace('owasp-agentic:', ''));
    else if (tag.startsWith('owasp:')) web.push(tag.replace('owasp:', ''));
  }
  return { web, agentic };
}

export interface MethodologyReport {
  risk_id: string;
  stride: StrideCategory[];
  fmea: FmeaScore;
  owasp: { web: string[]; agentic: string[] };
  /** True if the risk has at least one of (STRIDE category, OWASP mapping). */
  has_framework_anchor: boolean;
}

/**
 * Validate that every risk in the map has at least one external-framework
 * anchor (STRIDE or OWASP). A risk with no anchor is a smell — auditors
 * cannot trace it back to a standard threat catalog.
 */
export function methodologyCheck(map: RiskMap.RiskMap): MethodologyReport[] {
  return map.risks.map((risk) => {
    const stride = strideOf(risk);
    const owasp = owaspOf(risk);
    return {
      risk_id: risk.id,
      stride,
      fmea: fmeaScore(risk),
      owasp,
      has_framework_anchor: stride.length > 0 || owasp.web.length > 0 || owasp.agentic.length > 0,
    };
  });
}
