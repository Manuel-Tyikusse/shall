import type { Request, Response, NextFunction } from "express";
import { findTenantByApiKey } from "../persistence/tenantRepo.js";
import { createLogger } from "../logger.js";

const logger = createLogger("api-auth");

export interface TenantRequest extends Request {
  tenantId?: string;
}

export async function requireTenantAuth(req: TenantRequest, res: Response, next: NextFunction) {
  const header = req.headers["authorization"];
  const apiKey = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7) : undefined;

  if (!apiKey) {
    return res.status(401).json({ error: "em falta o cabeçalho Authorization: Bearer <chave-de-api>" });
  }

  try {
    const tenant = await findTenantByApiKey(apiKey);
    if (!tenant) {
      logger.warn("Chave de API inválida ou tenant inativo");
      return res.status(401).json({ error: "chave de API inválida" });
    }
    req.tenantId = tenant._id;
    next();
  } catch (err) {
    logger.error({ err }, "Falha ao validar chave de API");
    res.status(500).json({ error: "erro interno" });
  }
}
