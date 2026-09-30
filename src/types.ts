export type RiskReversibility = "reversible" | "irreversible" | "unknown";

/** Quem produziu a classificação — útil para auditoria e para perceber quando a IA está a ser usada. */
export type ClassificationSource = "rule" | "ai";

export interface RiskAssessment {
  reversibility: RiskReversibility;
  reason: string;
  confidence: number;
  source: ClassificationSource;
  matchedRule?: string;
}

export type ApprovalChannel = "voice";
export type ApprovalDecision = "approved" | "denied" | "timeout";
export type ContactMethod = "call" | "sms";

export interface ActivityLogEntry {
  id?: string;
  tenantId: string;
  timestamp: number;
  command: string;
  cwd?: string;
  agentLabel: string;
  assessment: RiskAssessment;
  outcome: "allowed" | "approved" | "blocked" | "denied" | "pending";
}
