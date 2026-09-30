import { execFileSync } from "node:child_process";
import { getRecentActivity } from "../persistence/activityRepo.js";
import { createLogger } from "../logger.js";
import { generateText } from "./gemini.js";
const logger = createLogger("project-assistant");

/** Responde por voz usando apenas o histórico observado e persistido pela CLI. */
export async function answerProjectQuestion(tenantId: string, question: string, language: string): Promise<string> {
  const activity = await getRecentActivity(tenantId, 20);
  if (activity.length === 0) return "Ainda não há atividade registada neste projeto.";

  const context = activity.map(({ timestamp, command, cwd, agentLabel, assessment, outcome }) => ({
    time: new Date(timestamp).toISOString(),
    directory: cwd ?? "desconhecida",
    agent: agentLabel,
    command,
    outcome,
    risk: assessment.reversibility,
  }));
  const latestCwd = activity.find((entry) => entry.cwd)?.cwd;
  let workingTree = "não disponível neste servidor";
  if (latestCwd) {
    try {
      workingTree = execFileSync("git", ["-C", latestCwd, "status", "--short", "--branch"], {
        encoding: "utf8",
        timeout: 1500,
        maxBuffer: 64 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() || "repositório limpo";
    } catch {
      workingTree = "não foi possível obter o estado Git atual";
    }
  }

  try {
    const answer = await generateText(
      "Respondes a perguntas de developers sobre o estado de um projeto, durante uma chamada telefónica. " +
        `Fala em ${language}. Usa apenas os registos fornecidos; não afirmes que sabes o estado atual dos ficheiros, ` +
        "testes ou deploy se isso não estiver nos registos. O estado Git é atual apenas quando fornecido; " +
        "o histórico de comandos regista autorizações, não prova que o processo terminou com sucesso. " +
        "Se não houver dados suficientes, diz isso claramente. Sê natural, breve e fácil de ouvir, no máximo 3 frases.",
      `Pergunta: ${question}\nEstado Git: ${workingTree}\nAtividade observada (mais recente primeiro): ${JSON.stringify(context)}`,
      220,
    );
    return answer || "Não consegui formular uma resposta com a atividade registada.";
  } catch (err) {
    logger.error({ err, tenantId }, "Falha ao preparar resposta de voz");
    const newest = activity[0];
    return `A chamada ao assistente de linguagem falhou. A última atividade registada foi ${newest.command}.`;
  }
}
