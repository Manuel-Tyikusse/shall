import { matchRule } from "./rules.js";
import { classifyWithAI } from "./aiClassifier.js";
import { getCachedClassification, setCachedClassification } from "../persistence/classificationCache.js";
import type { RiskAssessment } from "../types.js";
export { requiresApproval } from "./policy.js";

/**
 * As regras estáticas só decidem sozinhas quando têm confiança alta (>= 0.85)
 * — são a rede de segurança para os padrões mais óbvios e perigosos, e
 * continuam a funcionar mesmo que a API da IA esteja em baixo. Não vale a
 * pena colocá-las em cache (o regex já é barato).
 *
 * Para tudo o resto, consulta primeiro a cache (evita pagar/esperar por uma
 * nova chamada à IA para um comando já visto) e só invoca o agente de IA em
 * caso de miss, gravando o resultado para a próxima vez.
 */
export async function classifyCommand(
  command: string,
  context: { cwd: string; agentLabel: string; cache?: boolean }
): Promise<RiskAssessment> {
  const ruleMatch = matchRule(command);
  if (ruleMatch && ruleMatch.confidence >= 0.85) {
    return { ...ruleMatch, source: "rule" };
  }

  if (context.cache !== false) {
    const cached = await getCachedClassification(command, context.cwd);
    if (cached) return cached;
  }

  const assessment = await classifyWithAI(command, context);
  // Não guarda em cache respostas de fallback por falha da IA (confiança
  // baixa e deliberada, ver aiClassifier.ts) — senão um erro temporário da
  // API ficava "preso" em cache até expirar o TTL, mesmo depois de recuperar.
  if (context.cache !== false && assessment.confidence >= 0.3) {
    await setCachedClassification(command, context.cwd, assessment);
  }
  return assessment;
}
