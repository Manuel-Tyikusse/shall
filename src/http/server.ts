import express from "express";
import type { Server } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import { config } from "../config.js";
import { createLogger } from "../logger.js";
import { voiceRoutes, inboundVoiceRoutes } from "./voiceRoutes.js";
import { smsRoutes } from "./smsRoutes.js";
import { apiRoutes } from "./apiRoutes.js";

const logger = createLogger("server");
const publicRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../public");

export function createServer() {
  const app = express();

  // Cada router regista o seu próprio parser de body (voz/SMS usam
  // urlencoded e a API usa
  // json) — por isso não há um body-parser global aqui, para não consumir o
  // stream antes de chegar à rota certa.
  app.use("/voice", voiceRoutes());
  app.use("/voice", inboundVoiceRoutes());
  app.use("/sms", smsRoutes());
  app.use("/v1", apiRoutes()); // API para o cliente fino (Fase 2), autenticada por chave de API do tenant

  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.get("/", (_req, res) => res.sendFile(resolve(publicRoot, "index.html")));

  app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(err);
    const status = err instanceof ZodError ? 400 : Number((err as { statusCode?: number })?.statusCode) || 500;
    logger.error({ err, path: req.originalUrl, status }, "Pedido HTTP falhou");
    res.status(status).json({ error: status === 400 ? "pedido inválido" : "erro interno" });
  });

  return app;
}

export function startServer(): Promise<Server> {
  const app = createServer();
  return new Promise((resolve, reject) => {
    const server = app.listen(config.server.port, () => {
      logger.info({ port: config.server.port }, "Servidor a correr");
      resolve(server);
    });
    server.once("error", reject);
  });
}
