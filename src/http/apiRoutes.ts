import express, { Router } from "express";
import { z } from "zod";
import { requireTenantAuth, type TenantRequest } from "./apiAuth.js";
import { submitCommand } from "../core/evaluateCommand.js";
import { getStatus } from "../approval/wait.js";
import { getApproval } from "../persistence/approvalRepo.js";
import { addDeveloper, listDevelopers, removeDeveloper } from "../persistence/teamRepo.js";
import { getRecentActivity } from "../persistence/activityRepo.js";
import { createLogger } from "../logger.js";
import { asyncHandler } from "./asyncHandler.js";

const logger = createLogger("api-routes");

const submitSchema = z.object({
  command: z.string().min(1),
  cwd: z.string().min(1),
  agentLabel: z.string().min(1),
});

const addDeveloperSchema = z.object({
  name: z.string().min(1),
  phone: z.string().regex(/^\+\d{6,15}$/),
  priority: z.number().int().positive().default(1),
});

export function apiRoutes(): Router {
  const router = express.Router();
  router.use(express.json());
  router.use(requireTenantAuth);

  // --- Comandos (usado por clientes remotos supervisionados) ---

  router.post("/commands", asyncHandler(async (req: TenantRequest, res) => {
    const body = submitSchema.parse(req.body);
    try {
      const result = await submitCommand(req.tenantId!, body.command, body.cwd, body.agentLabel);
      res.json(result);
    } catch (err) {
      logger.error({ err, tenantId: req.tenantId }, "Falha ao processar submissão de comando");
      res.status(503).json({ error: "falha ao notificar a equipa; comando bloqueado por segurança" });
    }
  }));

  router.get("/commands/:id", asyncHandler(async (req: TenantRequest, res) => {
    try {
      const approval = await getApproval(req.params.id);
      if (approval.tenantId !== req.tenantId) return res.status(404).json({ error: "não encontrado" });
      const result = await getStatus(req.params.id);
      res.json(result);
    } catch {
      res.status(404).json({ error: "não encontrado" });
    }
  }));

  // --- Equipa ---

  router.get("/team", asyncHandler(async (req: TenantRequest, res) => {
    const devs = await listDevelopers(req.tenantId!, false);
    res.json(devs.map(({ _id, name, phone, priority, active }) => ({ _id, name, phone, priority, active })));
  }));

  router.post("/team", asyncHandler(async (req: TenantRequest, res) => {
    const body = addDeveloperSchema.parse(req.body);
    const dev = await addDeveloper(req.tenantId!, body);
    res.json(dev);
  }));

  router.delete("/team/:id", asyncHandler(async (req: TenantRequest, res) => {
    try {
      await removeDeveloper(req.tenantId!, req.params.id);
      res.json({ ok: true });
    } catch {
      res.status(404).json({ error: "não encontrado" });
    }
  }));

  // --- Histórico ---

  router.get("/activity", asyncHandler(async (req: TenantRequest, res) => {
    const limit = Number(req.query.limit ?? 20);
    const entries = await getRecentActivity(req.tenantId!, limit);
    res.json(entries);
  }));

  return router;
}
