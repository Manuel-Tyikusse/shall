import express, { Router } from "express";
import { z } from "zod";
import { createLogger } from "../logger.js";
import { findByPhoneAcrossTenants } from "../persistence/teamRepo.js";
import { findTenantById } from "../persistence/tenantRepo.js";
import { findLatestPendingContactedDeveloper, decide, appendTranscript } from "../persistence/approvalRepo.js";
import { sendSms } from "../channels/twilioSms.js";
import { interpretDecision } from "../classifier/decisionInterpreter.js";
import { verifyTwilioSignature } from "./verifyTwilio.js";
import { config } from "../config.js";
import { asyncHandler } from "./asyncHandler.js";
import { getStatus } from "../approval/wait.js";

const logger = createLogger("sms-routes");
const EMPTY_TWIML = `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;

const smsBodySchema = z.object({
  From: z.string(),
  Body: z.string().optional().default(""),
});

export function smsRoutes(): Router {
  const router = express.Router();
  router.use(express.urlencoded({ extended: false }));
  router.use(verifyTwilioSignature);

  router.post("/inbound", asyncHandler(async (req, res) => {
    const { From, Body } = smsBodySchema.parse(req.body);

    // O Twilio não indica o tenant diretamente (o número Twilio de origem é
    // partilhado por todos) — usa-se o telefone de quem responde para
    // encontrar a que developer/tenant pertence.
    const developer = await findByPhoneAcrossTenants(From);
    if (!developer) {
      logger.warn({ From }, "SMS recebido de número não reconhecido em nenhuma equipa");
      return res.type("text/xml").send(EMPTY_TWIML);
    }

    const approval = await findLatestPendingContactedDeveloper(developer.tenantId, developer._id);
    if (!approval) {
      logger.info({ developer: developer.name }, "SMS recebido sem aprovação pendente correspondente");
      return res.type("text/xml").send(EMPTY_TWIML);
    }

    if ((await getStatus(approval._id)).status !== "pending") {
      await sendSms(From, "shall: este pedido expirou ou já foi decidido; o comando continua bloqueado.");
      return res.type("text/xml").send(EMPTY_TWIML);
    }

    await appendTranscript(approval._id, `[SMS de ${developer.name}] ${Body}`);

    const tenant = await findTenantById(developer.tenantId);
    const decision = await interpretDecision(Body, tenant?.language);

    if (decision !== "ambiguous") {
      const updated = await decide(approval._id, decision, developer._id);
      const finalDecision = updated.status === "timeout" ? "timeout" : updated.status;
      if (finalDecision === "timeout") {
        await sendSms(From, "shall: este pedido expirou; o comando continua bloqueado.");
      }
      logger.info({ approvalId: approval._id, decision: finalDecision }, "Decisão registada via SMS");
      return res.type("text/xml").send(EMPTY_TWIML);
    }

    const priorSmsAttempts = approval.transcript.filter((t) => t.startsWith("[SMS")).length;

    if (priorSmsAttempts >= config.approval.maxClarificationAttempts) {
      await decide(approval._id, "denied", developer._id);
      await sendSms(From, "shall: não consegui perceber a tua resposta várias vezes, por segurança neguei este comando.");
      logger.info({ approvalId: approval._id }, "Negado por defeito após demasiadas respostas SMS ambíguas");
      return res.type("text/xml").send(EMPTY_TWIML);
    }

    await sendSms(From, `shall: não percebi. Responde se aprovas ou não para: "${approval.command}"`);
    logger.info({ approvalId: approval._id, priorSmsAttempts }, "Resposta SMS ambígua, a pedir clarificação");

    res.type("text/xml").send(EMPTY_TWIML);
  }));

  return router;
}
