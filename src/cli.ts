#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program.name("shall")
       .description(
       ""
      );

program.command("init")
       .description("Menu interativo para gerir a equipa de developers.")
       .action(async () => {
        const { runInitWizard } = await import("./init.js");
        await runInitWizard();
  });

program
  .command("daemon")
  .description("Mantém ativos os webhooks e a API usados pelos hooks dos agentes.")
  .action(async () => {
    const { startServer } = await import("./http/server.js");
    await startServer();
  });

program
  .command("dashboard")
  .description("Abre o painel administrativo local em http://127.0.0.1:3301.")
  .action(async () => {
    const { startDashboardServer } = await import("./http/dashboardServer.js");
    await startDashboardServer();
  });

const hook = program.command("hook").description("Integra os hooks pré-execução dos agentes com a avaliação do Shall.");
hook
  .command("check")
  .description("Lê um evento JSON do stdin e devolve a decisão no formato nativo do agente.")
  .requiredOption("--adapter <nome>", "shall, codex, claude, cursor ou gemini")
  .action(async (opts: { adapter: string }) => {
    const { runHook } = await import("./hooks/runHook.js");
    const supported = new Set(["shall", "codex", "claude", "cursor", "gemini"]);
    if (!supported.has(opts.adapter)) {
      console.error(`Adaptador desconhecido: ${opts.adapter}`);
      process.exitCode = 2;
      return;
    }
    await runHook(opts.adapter as "shall" | "codex" | "claude" | "cursor" | "gemini");
  });

program
  .command("log")
  .description("Mostra o histórico de comandos observados no tenant local (executados, negados, pendentes).")
  .option("--limit <numero>", "quantas entradas mostrar", "20")
  .action(async (opts: { limit: string }) => {
    const { getRecentActivity } = await import("./persistence/activityRepo.js");
    const { LOCAL_TENANT_ID } = await import("./persistence/tenantRepo.js");
    const entries = await getRecentActivity(LOCAL_TENANT_ID, Number(opts.limit));
    if (entries.length === 0) {
      console.log("Ainda não há atividade registada.");
      return;
    }
    const outcomeLabel: Record<string, string> = {
      allowed: "✓ permitido",
      approved: "✓ aprovado",
      denied: "✗ negado",
      blocked: "✗ bloqueado",
      pending: "… pendente",
    };
    for (const e of entries) {
      const when = new Date(e.timestamp).toLocaleString("pt-PT");
      console.log(
        `[${when}] ${outcomeLabel[e.outcome] ?? e.outcome} (${e.assessment.reversibility}, via ${e.assessment.source}) ` +
          `— ${e.agentLabel}: ${e.command}`
      );
    }
  });

const team = program.command("team").description("Gere a equipa do tenant local (equivalente não-interativo ao `shall init`).");

team
  .command("add")
  .description("Adiciona um developer à equipa.")
  .requiredOption("--name <nome>")
  .requiredOption("--phone <numero>", "formato E.164, ex: +351912345678")
  .option("--priority <numero>", "ordem de contacto; menor número é contactado primeiro", "1")
  .action(async (opts: { name: string; phone: string; priority: string }) => {
    const { addDeveloper } = await import("./persistence/teamRepo.js");
    const { LOCAL_TENANT_ID } = await import("./persistence/tenantRepo.js");
    const dev = await addDeveloper(LOCAL_TENANT_ID, {
      name: opts.name,
      phone: opts.phone,
      priority: Number(opts.priority),
    });
    console.log(`Adicionado: ${dev.name} (${dev.phone}), prioridade ${dev.priority}, id ${dev._id}`);
  });

team
  .command("list")
  .description("Lista a equipa, por ordem de contacto.")
  .action(async () => {
    const { listDevelopers } = await import("./persistence/teamRepo.js");
    const { LOCAL_TENANT_ID } = await import("./persistence/tenantRepo.js");
    const devs = await listDevelopers(LOCAL_TENANT_ID, false);
    if (devs.length === 0) {
      console.log("Equipa vazia. Usa `shall team add` para adicionar alguém.");
      return;
    }
    for (const d of devs) {
      console.log(
        `${d.active ? "✓" : "✗"} [prioridade ${d.priority}] ${d.name} — ${d.phone}` +
          ` — id:${d._id}`
      );
    }
  });

team
  .command("remove <id>")
  .description("Remove um developer da equipa pelo id (ver `shall team list`).")
  .action(async (id: string) => {
    const { removeDeveloper } = await import("./persistence/teamRepo.js");
    const { LOCAL_TENANT_ID } = await import("./persistence/tenantRepo.js");
    await removeDeveloper(LOCAL_TENANT_ID, id);
    console.log(`Removido: ${id}`);
  });

// --- Administração de tenants (clientes) — usado por ti, o operador, para provisionar cada cliente ---

const admin = program.command("admin").description("Administração de tenants (clientes) do serviço.");
const tenant = admin.command("tenant").description("Gere os clientes multi-tenant e as suas chaves de API.");

tenant
  .command("create")
  .description("Cria um novo tenant (cliente) com o developer principal já associado, e devolve a chave de API (só uma vez).")
  .requiredOption("--name <nome>", "nome do cliente/organização")
  .requiredOption("--dev-name <nome>", "nome do developer principal (primeiro contacto)")
  .requiredOption("--dev-phone <numero>", "telefone do developer principal, formato E.164")
  .option("--language <bcp47>", "código de língua para voz (ex: pt-PT, en-US)", "pt-PT")
  .action(async (opts: { name: string; devName: string; devPhone: string; language: string }) => {
    const { createTenant } = await import("./persistence/tenantRepo.js");
    const { tenant: t, apiKey } = await createTenant({
      name: opts.name,
      language: opts.language,
      primaryDeveloperName: opts.devName,
      primaryDeveloperPhone: opts.devPhone,
    });
    console.log(`Tenant criado: ${t.name} (id: ${t._id})`);
    console.log(`Chave de API (guarda-a agora, não volta a ser mostrada): ${apiKey}`);
  });

tenant
  .command("list")
  .description("Lista todos os tenants.")
  .action(async () => {
    const { listTenants } = await import("./persistence/tenantRepo.js");
    const tenants = await listTenants();
    if (tenants.length === 0) {
      console.log("Nenhum tenant criado ainda.");
      return;
    }
    for (const t of tenants) {
      console.log(`${t.active ? "✓" : "✗"} ${t.name} — id:${t._id} — chave:${t.apiKeyPrefix}... — língua:${t.language}`);
    }
  });

tenant
  .command("revoke <id>")
  .description("Desativa um tenant (a chave de API deixa de funcionar).")
  .action(async (id: string) => {
    const { revokeTenant } = await import("./persistence/tenantRepo.js");
    await revokeTenant(id);
    console.log(`Tenant ${id} desativado.`);
  });

program.parseAsync(process.argv);
