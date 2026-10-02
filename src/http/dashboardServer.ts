import express from "express";
import type { Server } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { config } from "../config.js";
import { createLogger } from "../logger.js";
import { getRecentActivity } from "../persistence/activityRepo.js";
import { authenticateAccount, createAccountSession, deleteAccountSession, getAccountForSession, publicAccount, registerAccount, accountSessionMaxAgeSeconds, type AccountDoc } from "../persistence/accountRepo.js";
import { listDevelopers } from "../persistence/teamRepo.js";
import { findTenantById, rotateTenantApiKey, type TenantDoc } from "../persistence/tenantRepo.js";
import { findRelease, listReleases } from "../persistence/releaseRepo.js";
import { tenantsDb } from "../persistence/couch.js";

const logger = createLogger("dashboard");
const dashboardRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../dashboard");
const packagePath = resolve(dirname(fileURLToPath(import.meta.url)), "../../package.json");
const activeWindowMs = 30 * 24 * 60 * 60 * 1000;
const sessionCookie = "shall_session";

function isLocalHost(host: string | undefined): boolean {
  const hostname = host?.split(":")[0]?.replace(/^\[|\]$/g, "").toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function readSessionToken(req: express.Request): string | null {
  const cookie = req.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${sessionCookie}=`));
  return cookie ? decodeURIComponent(cookie.slice(sessionCookie.length + 1)) : null;
}

function setSessionCookie(res: express.Response, token: string): void {
  res.cookie(sessionCookie, token, {
    httpOnly: true, sameSite: "strict", secure: false, path: "/",
    maxAge: accountSessionMaxAgeSeconds * 1000,
  });
}

const signupSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254),
  password: z.string().min(10).max(200),
  phone: z.string().regex(/^\+\d{6,15}$/),
});
const loginSchema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(200) });

export function createDashboardApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));
  app.use((req, res, next) => {
    if (!isLocalHost(req.headers.host)) return res.sendStatus(403);
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use("/api", (req, res, next) => {
    if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
      const origin = req.get("origin");
      let originHost = "";
      try { originHost = new URL(origin ?? "").host; } catch { /* reject below */ }
      if (!origin || originHost !== req.get("host") || !isLocalHost(originHost)) return res.sendStatus(403);
    }
    next();
  });

  app.post("/api/auth/signup", async (req, res, next) => {
    try {
      const input = signupSchema.parse(req.body);
      const result = await registerAccount(input);
      const token = await createAccountSession(result.account);
      const tenant = await findTenantById(result.account.tenantId);
      if (!tenant) throw new Error("New account tenant was not created.");
      setSessionCookie(res, token);
      res.status(201).json({ account: publicAccount(result.account, tenant), apiKey: result.apiKey });
    } catch (err) {
      if ((err as { statusCode?: number })?.statusCode === 409) return res.status(409).json({ error: (err as Error).message });
      if (err instanceof z.ZodError) return res.status(400).json({ error: "Enter a valid name, email, password (at least 10 characters), and phone in international format." });
      next(err);
    }
  });

  app.post("/api/auth/login", async (req, res, next) => {
    try {
      const input = loginSchema.parse(req.body);
      const account = await authenticateAccount(input.email, input.password);
      if (!account) return res.status(401).json({ error: "Email or password is incorrect." });
      const tenant = await findTenantById(account.tenantId);
      if (!tenant?.active) return res.status(403).json({ error: "This Shall account is inactive." });
      setSessionCookie(res, await createAccountSession(account));
      res.json({ account: publicAccount(account, tenant) });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ error: "Enter a valid email and password." });
      next(err);
    }
  });

  app.get("/api/auth/me", async (req, res, next) => {
    try {
      const token = readSessionToken(req);
      const account = token ? await getAccountForSession(token) : null;
      const tenant = account ? await findTenantById(account.tenantId) : null;
      if (!account || !tenant?.active) return res.status(401).json({ error: "Sign in to continue." });
      res.json({ account: publicAccount(account, tenant) });
    } catch (err) { next(err); }
  });

  app.post("/api/auth/logout", async (req, res, next) => {
    try {
      const token = readSessionToken(req);
      if (token) await deleteAccountSession(token);
      res.clearCookie(sessionCookie, { httpOnly: true, sameSite: "strict", path: "/" });
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  app.use("/api", async (req, res, next) => {
    try {
      const token = readSessionToken(req);
      const account = token ? await getAccountForSession(token) : null;
      const tenant = account ? await findTenantById(account.tenantId) : null;
      if (!account || !tenant?.active) return res.status(401).json({ error: "Sign in to continue." });
      res.locals.account = account;
      res.locals.tenant = tenant;
      next();
    } catch (err) { next(err); }
  });

  app.get("/api/overview", async (_req, res, next) => {
    try {
      const account = res.locals.account as AccountDoc;
      const tenant = res.locals.tenant as TenantDoc;
      const [activity, developers, metadata, releases] = await Promise.all([
        getRecentActivity(tenant._id, 500), listDevelopers(tenant._id),
        readFile(packagePath, "utf8").then((raw) => JSON.parse(raw) as { version: string }), listReleases(),
      ]);
      const activeSince = Date.now() - activeWindowMs;
      const recentActivity = activity.filter((entry) => entry.timestamp >= activeSince);
      res.json({
        generatedAt: Date.now(), version: metadata.version,
        account: { name: account.name, email: account.email, teamName: tenant.name, plan: "beta", targetVersion: tenant.targetVersion ?? null },
        metrics: {
          active: tenant.active ? 1 : 0, developers: developers.length,
          commands30d: recentActivity.length,
          downloads: { value: null, connected: false },
          billing: { connected: false, provider: "Paddle", status: "not_configured" },
          versions: { current: metadata.version, available: [...new Set([metadata.version, ...releases.map((release) => release.version)])] },
        },
        recentActivity: recentActivity.slice(0, 12).map((entry) => ({ timestamp: entry.timestamp, outcome: entry.outcome, command: entry.command })),
      });
    } catch (err) { next(err); }
  });

  app.get("/api/testers", async (_req, res, next) => {
    try {
      const tenant = res.locals.tenant as TenantDoc;
      const developers = await listDevelopers(tenant._id, false);
      res.json({ testers: [{
        id: tenant._id, name: tenant.name, active: tenant.active,
        targetVersion: tenant.targetVersion ?? null,
        developers: developers.filter((developer) => developer.active).map((developer) => developer.name),
      }] });
    } catch (err) { next(err); }
  });

  app.get("/api/releases", async (_req, res, next) => {
    try {
      const [releases, metadata] = await Promise.all([
        listReleases(), readFile(packagePath, "utf8").then((raw) => JSON.parse(raw) as { version: string }),
      ]);
      if (!releases.some((release) => release.version === metadata.version)) {
        releases.unshift({ _id: `release:${metadata.version}`, type: "release", version: metadata.version, channel: "beta", notes: "Current local version", createdAt: 0 });
      }
      res.json({ releases });
    } catch (err) { next(err); }
  });

  app.patch("/api/account/version", async (req, res, next) => {
    try {
      const tenant = res.locals.tenant as TenantDoc;
      const version = req.body?.version;
      if (version !== null && typeof version !== "string") return res.status(400).json({ error: "Choose a version or select Automatic." });
      if (version !== null) {
        const [release, metadata] = await Promise.all([
          findRelease(version), readFile(packagePath, "utf8").then((raw) => JSON.parse(raw) as { version: string }),
        ]);
        if (version !== metadata.version && !release) return res.status(400).json({ error: "That version is not in the release catalogue." });
      }
      const updated = { ...tenant, ...(version === null ? {} : { targetVersion: version }) } as TenantDoc & Record<string, unknown>;
      if (version === null) delete updated.targetVersion;
      const result = await tenantsDb.insert(updated);
      res.json({ version, rev: result.rev });
    } catch (err) { next(err); }
  });

  app.post("/api/account/api-key", async (_req, res, next) => {
    try {
      const tenant = res.locals.tenant as TenantDoc;
      res.json({ apiKey: await rotateTenantApiKey(tenant._id) });
    } catch (err) { next(err); }
  });

  app.get("/", (_req, res) => res.type("html").send("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>Shall dashboard</title><body><main><h1>Shall dashboard</h1><p>Run the shall-website development server and open its dashboard page. This service only accepts local connections.</p></main></body></html>"));
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error({ err }, "Dashboard request failed");
    res.status(500).json({ error: "The dashboard could not complete this request." });
  });
  return app;
}

export function startDashboardServer(): Promise<Server> {
  const app = createDashboardApp();
  return new Promise((resolvePromise, reject) => {
    const server = app.listen(config.dashboard.port, "127.0.0.1", () => {
      logger.info({ host: "127.0.0.1", port: config.dashboard.port }, "Local dashboard API running");
      resolvePromise(server);
    });
    server.once("error", reject);
  });
}
