import type { RiskAssessment } from "../types.js";

/** Low-confidence and unknown assessments require a human decision. */
export function requiresApproval(assessment: RiskAssessment): boolean {
  return assessment.reversibility !== "reversible" || assessment.confidence < 0.7;
}
