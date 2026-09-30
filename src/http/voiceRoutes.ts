import express, { Router } from "express";
import twilio from "twilio";
import { z } from "zod";
import { config } from "../config.js";
import { createLogger } from "../logger.js";
import { getApproval, decide, appendTranscript, appendContact } from "../persistence/approvalRepo.js";
import { listDevelopers, findByPhoneAcrossTenants } from "../persistence/teamRepo.js";
import { findTenantById } from "../persistence/tenantRepo.js";
import { callDeveloper } from "../channels/twilioVoice.js";
import { sendApprovalSms } from "../channels/twilioSms.js";
import { answerProjectQuestion } from "../classifier/projectAssistant.js";
import { getStatus } from "../approval/wait.js";
import { interpretDecision } from "../classifier/decisionInterpreter.js";
import { verifyTwilioSignature } from "./verifyTwilio.js";
import { asyncHandler } from "./asyncHandler.js";

const { VoiceResponse } = twilio.twiml;
const logger = createLogger("voice-routes");

const gatherBodySchema = z.object({ SpeechResult: z.string().optional().default("") });
const statusBodySchema = z.object({ CallStatus: z.string().optional().default("") });
const inboundCallSchema = z.object({ From: z.string().optional().default("") });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function languageFor(tenantId: string): Promise<any> {
  const tenant = await findTenantById(tenantId);
  // any: os tipos do SDK do Twilio restringem "language" a uma união fixa de
  // códigos suportados; guardamos o código como string livre (BCP-47) e
  // confiamos que corresponde a um dos suportados pelo Twilio.
  return tenant?.language ?? "pt-PT";
}

export function voiceRoutes(): Router {
  const router = express.Router();
  router.use(express.urlencoded({ extended: false })); // Twilio envia form-urlencoded
  router.use(verifyTwilioSignature);

  router.post("/approval/:id", asyncHandler(async (req, res) => {
    const { id } = req.params;
    const approval = await getApproval(id).catch(() => undefined);
    const status = approval ? await getStatus(id) : undefined;
    const vr = new VoiceResponse();

    if (!approval || status?.status !== "pending") {
      vr.say("Este pedido já não é válido. A desligar.");
      vr.hangup();
      return res.type("text/xml").send(vr.toString());
    }

    const language = await languageFor(approval.tenantId);
    const gather = vr.gather({
      input: ["speech"],
      language,
      speechTimeout: "auto",
      action: `${config.server.publicUrl}/voice/approval/${id}/respond`,
      method: "POST",
    });
    gather.say(
      { language },
      `O agente ${approval.agentLabel} quer executar o seguinte comando: ${approval.command}. ` +
        `${approval.assessment.reason} Aprovas?`
    );
    vr.redirect(`${config.server.publicUrl}/voice/approval/${id}`);
    res.type("text/xml").send(vr.toString());
  }));

  router.post("/approval/:id/respond", asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { SpeechResult } = gatherBodySchema.parse(req.body);
    const approval = await getApproval(id).catch(() => undefined);
    const status = approval ? await getStatus(id) : undefined;
    const vr = new VoiceResponse();

    if (!approval || status?.status !== "pending") {
      vr.say("Este pedido já não é válido.");
      vr.hangup();
      return res.type("text/xml").send(vr.toString());
    }

    const language = await languageFor(approval.tenantId);
    await appendTranscript(id, `[Voz] ${SpeechResult}`);
    const decision = await interpretDecision(SpeechResult, language);

    if (decision !== "ambiguous") {
      const updated = await decide(id, decision);
      if (updated.status === "timeout") {
        vr.say({ language }, "Este pedido expirou e o comando continua bloqueado.");
        vr.hangup();
        return res.type("text/xml").send(vr.toString());
      }
      const finalDecision = updated.status === "approved" ? "approved" : "denied";
      vr.say(
        { language },
        finalDecision === "approved" ? "Entendido, comando aprovado. Obrigado." : "Entendido, comando negado. Obrigado."
      );
      vr.hangup();
      return res.type("text/xml").send(vr.toString());
    }

    const attempts = approval.transcript.length;
    if (attempts >= config.approval.maxClarificationAttempts) {
      await decide(id, "denied");
      vr.say({ language }, "Não consegui perceber a tua resposta várias vezes, por segurança vou negar este comando.");
      vr.hangup();
      return res.type("text/xml").send(vr.toString());
    }

    const gather = vr.gather({
      input: ["speech"],
      language,
      speechTimeout: "auto",
      action: `${config.server.publicUrl}/voice/approval/${id}/respond`,
      method: "POST",
    });
    gather.say({ language }, "Desculpa, não percebi bem. Responde claramente aprovo, ou não aprovo.");
    res.type("text/xml").send(vr.toString());
  }));

  // Callback de estado da chamada: se não foi atendida, tenta SMS + o próximo
  // developer da equipa por ordem de prioridade.
  router.post("/approval/:id/status/:attemptIndex", asyncHandler(async (req, res) => {
    res.status(200).send(); // responde já; o resto corre em background
    const { id, attemptIndex } = req.params;
    const { CallStatus } = statusBodySchema.parse(req.body);
    logger.info({ id, CallStatus, attemptIndex }, "Callback de estado da chamada");

    if (!["no-answer", "busy", "failed", "canceled"].includes(CallStatus)) return;

    const approval = await getApproval(id).catch(() => undefined);
    if (!approval || (await getStatus(id)).status !== "pending") return;

    const devs = await listDevelopers(approval.tenantId);
    const idx = Number(attemptIndex);
    const current = devs[idx];

    if (current) {
      try {
        await sendApprovalSms(id, current.phone, approval.command, approval.assessment.reason);
        await appendContact(id, current._id, "sms");
      } catch (err) {
        logger.error({ err }, "Falha ao enviar SMS de fallback");
      }
    }

    const next = devs[idx + 1];
    if (next) {
      try {
        await appendContact(id, next._id, "call");
        await callDeveloper(id, next.phone, idx + 1);
      } catch (err) {
        logger.error({ err }, "Falha ao ligar ao próximo developer da equipa");
      }
    } else {
      logger.warn({ id }, "Equipa esgotada; a aguardar SMS ou timeout final.");
    }
  }));

  return router;
}

/**
 * Fluxo inverso: o developer liga e pergunta pelo estado do projeto. Tal
 * como no SMS, o "From" (o número de quem liga) é a única forma de saber a
 * que tenant a chamada pertence — não há como o Twilio nos dizer isso
 * diretamente quando o número de entrada é partilhado por todos os tenants.
 */
export function inboundVoiceRoutes(): Router {
  const router = express.Router();
  router.use(express.urlencoded({ extended: false }));
  router.use(verifyTwilioSignature);

  router.post("/inbound", asyncHandler(async (req, res) => {
    const { From } = inboundCallSchema.parse(req.body);
    const vr = new VoiceResponse();
    const developer = await findByPhoneAcrossTenants(From);

    if (!developer) {
      vr.say("Desculpa, não reconheço este número. A desligar.");
      vr.hangup();
      return res.type("text/xml").send(vr.toString());
    }

    const language = await languageFor(developer.tenantId);
    const gather = vr.gather({
      input: ["speech"],
      language,
      speechTimeout: "auto",
      action: `${config.server.publicUrl}/voice/inbound/respond`,
      method: "POST",
    });
    gather.say({ language }, "Olá! O que queres saber sobre o projeto?");
    res.type("text/xml").send(vr.toString());
  }));

  router.post("/inbound/respond", asyncHandler(async (req, res) => {
    const { SpeechResult } = gatherBodySchema.parse(req.body);
    const { From } = inboundCallSchema.parse(req.body);
    const vr = new VoiceResponse();
    const developer = await findByPhoneAcrossTenants(From);

    if (!developer) {
      vr.hangup();
      return res.type("text/xml").send(vr.toString());
    }

    const language = await languageFor(developer.tenantId);

    if (/\b(adeus|até logo|terminar|desligar|bye|goodbye)\b/i.test(SpeechResult)) {
      vr.say({ language }, "Até já.");
      vr.hangup();
      return res.type("text/xml").send(vr.toString());
    }

    const answer = await answerProjectQuestion(developer.tenantId, SpeechResult, language);

    const gather = vr.gather({
      input: ["speech"],
      language,
      speechTimeout: "auto",
      action: `${config.server.publicUrl}/voice/inbound/respond`,
      method: "POST",
    });
    gather.say({ language }, answer + " Queres saber mais alguma coisa?");
    res.type("text/xml").send(vr.toString());
  }));

  return router;
}
