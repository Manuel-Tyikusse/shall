import type { RiskAssessment } from "../types.js";

interface Rule {
  name: string;
  test: RegExp;
  assessment: Omit<RiskAssessment, "matchedRule" | "confidence" | "source">;
  confidence: number;
}

/**
 * Regras avaliadas por ordem. A primeira que corresponder define a classificação.
 * Mantém isto o mais explícito possível — é a tua rede de segurança principal,
 * a LLM de fallback (ver riskClassifier.ts) só entra quando nada aqui bate certo.
 */
export const RULES: Rule[] = [
  {
    name: "delete-recursive-force",
    test: /\brm\s+(-\w*r\w*f\w*|-\w*f\w*r\w*)\b/,
    assessment: {
      reversibility: "irreversible",
      reason: "Apaga ficheiros/pastas de forma recursiva e forçada, sem confirmação nem lixo.",
    },
    confidence: 0.95,
  },
  {
    name: "git-force-push",
    test: /\bgit\s+push\s+.*--force\b|\bgit\s+push\s+.*-f\b/,
    assessment: {
      reversibility: "irreversible",
      reason: "Reescreve o histórico remoto; pode destruir commits de outras pessoas.",
    },
    confidence: 0.9,
  },
  {
    name: "git-reset-hard",
    test: /\bgit\s+reset\s+--hard\b/,
    assessment: {
      reversibility: "irreversible",
      reason: "Descarta alterações locais não commitadas de forma permanente.",
    },
    confidence: 0.85,
  },
  {
    name: "db-drop-truncate",
    test: /\b(DROP\s+(TABLE|DATABASE|SCHEMA)|TRUNCATE\s+TABLE)\b/i,
    assessment: {
      reversibility: "irreversible",
      reason: "Elimina dados/estrutura de base de dados de forma permanente.",
    },
    confidence: 0.95,
  },
  {
    name: "cloud-resource-delete",
    test: /\b(terraform\s+destroy|aws\s+\S+\s+delete-|gcloud\s+\S+\s+delete|kubectl\s+delete\s+(namespace|pv|pvc))\b/i,
    assessment: {
      reversibility: "irreversible",
      reason: "Destrói infraestrutura ou recursos cloud provisionados.",
    },
    confidence: 0.9,
  },
  {
    name: "payment-or-billing-api",
    test: /\b(stripe|paypal)\S*\s+(charge|refund|payout)/i,
    assessment: {
      reversibility: "irreversible",
      reason: "Interage com dinheiro real através de uma API de pagamentos.",
    },
    confidence: 0.85,
  },
  {
    name: "production-deploy",
    test: /\b(deploy|release)\b.*\b(prod|production)\b/i,
    assessment: {
      reversibility: "irreversible",
      reason: "Publica alterações em ambiente de produção.",
    },
    confidence: 0.75,
  },
  {
    name: "package-install",
    test: /\b(npm|pnpm|yarn)\s+(install|add)\b|\bpip\s+install\b/,
    assessment: {
      reversibility: "reversible",
      reason: "Instala dependências; reversível removendo o pacote ou o lockfile.",
    },
    confidence: 0.6,
  },
  {
    name: "read-only-inspection",
    // Apenas comandos simples. Metacaracteres e redirecionamentos passam à IA
    // e nunca são aprovados como leitura só por começarem com `ls` ou `echo`.
    test: /^\s*(ls|cat|grep|find|git\s+(status|log|diff|show)|pwd|echo)\b[^;&|><`$()\n]*$/,
    assessment: {
      reversibility: "reversible",
      reason: "Comando de leitura/inspeção, não altera estado.",
    },
    confidence: 0.9,
  },
];

export function matchRule(command: string): Omit<RiskAssessment, "source"> | null {
  for (const rule of RULES) {
    if (rule.test.test(command)) {
      return { ...rule.assessment, confidence: rule.confidence, matchedRule: rule.name };
    }
  }
  return null;
}
