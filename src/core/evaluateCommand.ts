import { classifyCommand, requiresApproval } from "../classifier/riskClassifier.js";
import { createApproval, decide } from "../persistence/approvalRepo.js";
import { notifyForApproval } from "../approval/orchestrator.js";
import { recordActivity } from "../persistence/activityRepo.js";
import { config } from "../config.js";
import type { RiskAssessment } from "../types.js";

export interface SubmitResult {
  requiresApproval: boolean;
  assessment: RiskAssessment;
  approvalId?: string;
}

/**
 * Classifica o comando e, se precisar de aprovação, cria o registo e
 * dispara a chamada de aprovação — mas NÃO espera pela decisão
 * (isso é `waitForDecision`/`getStatus`, chamado à parte). Mantém esta
 * função rápida para poder ser usada tanto localmente como numa rota HTTP
 * sem bloquear o pedido durante minutos.
 */
export async function submitCommand(
  tenantId: string,
  command: string,
  cwd: string,
  agentLabel: string,
  forceApprovalReason?: string,
  classificationInput = command
): Promise<SubmitResult> {
  const classified = await classifyCommand(classificationInput, {
    cwd,
    agentLabel,
    cache: classificationInput === command,
  });
  const assessment: RiskAssessment = forceApprovalReason
    ? {
        ...classified,
        reversibility: "unknown",
        confidence: 0,
        reason: forceApprovalReason,
      }
    : classified;

  if (!requiresApproval(assessment)) {
    await recordActivity({ tenantId, timestamp: Date.now(), command, cwd, agentLabel, assessment, outcome: "allowed" });
    return { requiresApproval: false, assessment };
  }

  const channel = "voice" as const;
  const timeoutMs = config.approval.timeoutMs;

  const approval = await createApproval({
    tenantId,
    command,
    cwd,
    agentLabel,
    assessment,
    channel,
    createdAt: Date.now(),
    timeoutMs,
  });

  await recordActivity({
    tenantId,
    id: approval._id,
    timestamp: approval.createdAt,
    command,
    cwd,
    agentLabel,
    assessment,
    outcome: "pending",
  });

  // Se isto lançar (ex: sem developers configurados), quem chamou decide
  // como tratar — localmente bloqueamos o comando; na API devolve-se erro.
  try {
    await notifyForApproval(approval);
  } catch (err) {
    await decide(approval._id, "denied");
    throw err;
  }

  return { requiresApproval: true, assessment, approvalId: approval._id };
}
