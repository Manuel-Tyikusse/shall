import twilio from "twilio";
import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";
import { createLogger } from "../logger.js";

const logger = createLogger("twilio-verify");

/**
 * Confirma que o pedido veio mesmo do Twilio, usando o cabeçalho
 * X-Twilio-Signature (HMAC-SHA1 do URL + parâmetros do form, com o Auth Token
 * como chave). Sem isto, qualquer pessoa que descubra o PUBLIC_URL pode
 * forjar um POST e aprovar/negar comandos fingindo ser o Twilio.
 *
 * Tem de correr DEPOIS do body parser (precisa de req.body já parseado).
 */
export function verifyTwilioSignature(req: Request, res: Response, next: NextFunction) {
  const signature = req.headers["x-twilio-signature"] as string | undefined;
  if (!signature) {
    logger.warn({ path: req.originalUrl }, "Pedido sem cabeçalho X-Twilio-Signature, a rejeitar");
    return res.status(403).send("missing signature");
  }

  const url = `${config.server.publicUrl}${req.originalUrl}`;
  const valid = twilio.validateRequest(
    config.twilio.authToken,
    signature,
    url,
    req.body as Record<string, string>
  );

  if (!valid) {
    logger.warn({ path: req.originalUrl, url }, "Assinatura Twilio inválida, a rejeitar");
    return res.status(403).send("invalid signature");
  }

  next();
}
