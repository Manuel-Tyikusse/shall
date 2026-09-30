import crypto from "node:crypto";
import { classificationCacheDb } from "./couch.js";
import { config } from "../config.js";
import { createLogger } from "../logger.js";
import type { RiskAssessment } from "../types.js";

const logger = createLogger("classification-cache");

interface CacheDoc {
  _id: string;
  _rev?: string;
  type: "classification-cache";
  command: string;
  cwd: string;
  assessment: RiskAssessment;
  cachedAt: number;
}

/**
 * Chave = hash do texto exato do comando. Isto significa que só há hit para
 * o MESMO comando, byte a byte — não tenta perceber variações semanticamente
 * equivalentes (ex: "npm install lodash" vs "npm i lodash" não partilham
 * cache). É uma escolha conservadora: mais seguro ter um miss extra do que
 * reutilizar uma classificação que pode não se aplicar.
 */
function keyFor(command: string, cwd: string): string {
  return crypto.createHash("sha256").update(JSON.stringify([cwd, command])).digest("hex");
}

export async function getCachedClassification(command: string, cwd: string): Promise<RiskAssessment | null> {
  try {
    const doc = (await classificationCacheDb.get(keyFor(command, cwd))) as CacheDoc;
    const isExpired = Date.now() - doc.cachedAt > config.classification.cacheTtlMs;
    if (isExpired) return null;
    logger.info({ command }, "Cache hit para classificação");
    return doc.assessment;
  } catch (err: unknown) {
    const statusCode = (err as { statusCode?: number })?.statusCode;
    if (statusCode === 404) return null; // miss normal, não é erro
    logger.warn({ err }, "Falha ao consultar cache de classificação; a ignorar cache");
    return null;
  }
}

export async function setCachedClassification(command: string, cwd: string, assessment: RiskAssessment): Promise<void> {
  const _id = keyFor(command, cwd);
  try {
    // Tenta atualizar por cima de um doc existente (ex: TTL expirado), senão cria de novo.
    let _rev: string | undefined;
    try {
      const existing = (await classificationCacheDb.get(_id)) as CacheDoc;
      _rev = existing._rev;
    } catch {
      _rev = undefined;
    }
    await classificationCacheDb.insert({
      _id,
      _rev,
      type: "classification-cache",
      command,
      cwd,
      assessment,
      cachedAt: Date.now(),
    } as CacheDoc);
  } catch (err) {
    // A cache é uma otimização, não uma fonte de verdade — uma falha aqui
    // não deve impedir o comando de ser classificado/executado.
    logger.warn({ err }, "Falha ao gravar cache de classificação; a continuar sem cache");
  }
}
