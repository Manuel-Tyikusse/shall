import "dotenv/config";
import { z } from "zod";
import { logger } from "./logger.js";

const phoneNumber = z
  .string()
  .regex(/^\+\d{6,15}$/, "número de telefone deve estar em formato E.164, ex: +351912345678");

const envSchema = z.object({
  // Twilio (voz + SMS)
  TWILIO_ACCOUNT_SID: z.string().regex(/^AC[a-zA-Z0-9]{32}$/, "TWILIO_ACCOUNT_SID inválido"),
  TWILIO_AUTH_TOKEN: z.string().min(20, "TWILIO_AUTH_TOKEN inválido"),
  TWILIO_FROM_NUMBER: phoneNumber,
  CALL_RING_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(25),

  // Servidor
  PUBLIC_URL: z.string().url("PUBLIC_URL tem de ser um URL válido (ex: https://xxxx.ngrok-free.app)"),
  PORT: z.coerce.number().int().positive().default(3300),

  // Aprovação
  APPROVAL_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  MAX_CLARIFICATION_ATTEMPTS: z.coerce.number().int().positive().default(3),

  // CouchDB
  COUCHDB_URL: z.string().url("COUCHDB_URL tem de ser um URL válido, ex: http://admin:pass@localhost:5984"),
  COUCHDB_ACTIVITY_DB: z.string().default("agent_guard_activity"),
  COUCHDB_APPROVALS_DB: z.string().default("agent_guard_approvals"),
  COUCHDB_TEAM_DB: z.string().default("agent_guard_team"),
  COUCHDB_CLASSIFICATION_CACHE_DB: z.string().default("agent_guard_classification_cache"),
  COUCHDB_TENANTS_DB: z.string().default("agent_guard_tenants"),
  CLASSIFICATION_CACHE_TTL_MS: z.coerce.number().int().positive().default(24 * 60 * 60_000),

  // Google Gemini (classificação e assistente)
  GEMINI_API_KEY: z.string().min(10, "GEMINI_API_KEY em falta"),
  GEMINI_MODEL: z.string().default("gemini-3.8-flash"),
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    logger.error(
      { issues: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })) },
      "Configuração inválida. Corre `shall init` ou corrige o teu .env."
    );
    process.exit(1);
  }
  return parsed.data;
}

const env = loadEnv();

export const config = {
  twilio: {
    accountSid: env.TWILIO_ACCOUNT_SID,
    authToken: env.TWILIO_AUTH_TOKEN,
    fromNumber: env.TWILIO_FROM_NUMBER,
    callRingTimeoutSeconds: env.CALL_RING_TIMEOUT_SECONDS,
  },
  server: {
    publicUrl: env.PUBLIC_URL,
    port: env.PORT,
  },
  approval: {
    timeoutMs: env.APPROVAL_TIMEOUT_MS,
    maxClarificationAttempts: env.MAX_CLARIFICATION_ATTEMPTS,
  },
  couchdb: {
    url: env.COUCHDB_URL,
    activityDb: env.COUCHDB_ACTIVITY_DB,
    approvalsDb: env.COUCHDB_APPROVALS_DB,
    teamDb: env.COUCHDB_TEAM_DB,
    classificationCacheDb: env.COUCHDB_CLASSIFICATION_CACHE_DB,
    tenantsDb: env.COUCHDB_TENANTS_DB,
  },
  classification: {
    cacheTtlMs: env.CLASSIFICATION_CACHE_TTL_MS,
  },
  gemini: {
    apiKey: env.GEMINI_API_KEY,
    model: env.GEMINI_MODEL,
  },
};
