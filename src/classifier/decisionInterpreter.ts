import { z } from "zod";
import { createLogger } from "../logger.js";
import { generateJson } from "./gemini.js";

const logger = createLogger("decision-interpreter");

const schema = z.object({
  decision: z.enum(["approved", "denied", "ambiguous"]),
});

const SYSTEM_PROMPT = `Interpretas a resposta de um developer a um pedido de aprovação de um comando, vinda de voz transcrita ou de SMS. A resposta pode estar em QUALQUER língua — não assumas português.

Classifica como:
- "approved": a pessoa concorda claramente que o comando pode avançar (ex: "sim", "yes", "aprovo", "go ahead", "oui", "ok pode ser", "vai lá").
- "denied": a pessoa recusa claramente (ex: "não", "no", "nego", "stop", "cancela", "de jeito nenhum").
- "ambiguous": não dá para perceber com confiança (resposta vazia, incompreensível, fora de tópico, ou genuinamente indecisa como "talvez" ou "não sei").

Responde APENAS com um objeto JSON válido, sem markdown, sem texto antes ou depois:
{"decision": "approved" | "denied" | "ambiguous"}`;

/**
 * `expectedLanguage` é só uma dica opcional (ex: "pt-PT", "en-US", vinda das
 * definições do tenant) — a IA interpreta a resposta em qualquer língua de
 * qualquer forma; a dica ajuda em respostas curtas e ambíguas entre línguas
 * (ex: "si" em espanhol vs. outro uso).
 */
export async function interpretDecision(
  userReply: string,
  expectedLanguage?: string
): Promise<"approved" | "denied" | "ambiguous"> {
  const trimmed = userReply.trim();
  if (!trimmed) return "ambiguous";

  try {
    const raw = await generateJson(SYSTEM_PROMPT, `Língua esperada (dica, pode estar errada): ${expectedLanguage ?? "desconhecida"}\nResposta do developer: "${trimmed}"`, 100);
    if (!raw) return "ambiguous";
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const parsed = schema.parse(JSON.parse(cleaned));
    return parsed.decision;
  } catch (err) {
    logger.error({ err, userReply: trimmed }, "Falha ao interpretar decisão via IA; a tratar como ambíguo.");
    return "ambiguous";
  }
}
