import * as p from "@clack/prompts";
import { addDeveloper, listDevelopers, removeDeveloper } from "./persistence/teamRepo.js";
import { findTenantById, ensureLocalOperatorTenant, LOCAL_TENANT_ID } from "./persistence/tenantRepo.js";

/**
 * Este assistente NÃO toca em infraestrutura (Twilio, CouchDB, URL público,
 * chave do Google Gemini) — isso é gerido diretamente no .env por quem faz o
 * deploy. Aqui só se gere o "tenant local do operador" (para testares nesta
 * máquina antes de teres o cliente fino da Fase 2 a falar com a API): quem é
 * contactado e o número de cada developer.
 */
export async function runInitWizard() {
  p.intro("shall — gestão da equipa (tenant local)");

  const tenant = await findTenantById(LOCAL_TENANT_ID);
  if (!tenant) {
    p.note("Primeira utilização: precisamos de pelo menos um developer para poder pedir aprovações.", "Configuração inicial");
    const name = bail(await p.text({ message: "O teu nome", validate: (v) => (v.trim() ? undefined : "Obrigatório") }));
    const phone = bail(
      await p.text({
        message: "O teu telefone (E.164)",
        placeholder: "+351912345678",
        validate: (v) => (/^\+\d{6,15}$/.test(v) ? undefined : "Usa o formato E.164, ex: +351912345678"),
      })
    );
    await ensureLocalOperatorTenant(name, phone);
    p.log.success("Tenant local criado.");
  }

  let exit = false;
  while (!exit) {
    const action = await p.select({
      message: "O que queres fazer?",
      options: [
        { value: "add", label: "Adicionar membro à equipa" },
        { value: "remove", label: "Remover membro da equipa" },
        { value: "list", label: "Listar equipa" },
        { value: "exit", label: "Sair" },
      ],
    });
    if (p.isCancel(action)) break;

    try {
      switch (action) {
        case "add":
          await addDeveloperFlow();
          break;
        case "remove":
          await removeDeveloperFlow();
          break;
        case "list":
          await listDevelopersFlow();
          break;
        case "exit":
          exit = true;
          break;
      }
    } catch (err) {
      if (!(err instanceof Error && err.message === "cancelled")) throw err;
      // operação cancelada a meio (Ctrl+C num prompt) -> volta ao menu
    }
  }

  p.outro("Até já.");
}

async function addDeveloperFlow() {
  const name = bail(await p.text({ message: "Nome", validate: (v) => (v.trim() ? undefined : "Obrigatório") }));
  const phone = bail(
    await p.text({
      message: "Telefone (E.164)",
      placeholder: "+351912345678",
      validate: (v) => (/^\+\d{6,15}$/.test(v) ? undefined : "Usa o formato E.164, ex: +351912345678"),
    })
  );
  const priorityStr = bail(
    await p.text({
      message: "Prioridade de contacto (1 = contactado primeiro)",
      initialValue: "1",
      validate: (v) => (Number.isInteger(Number(v)) && Number(v) > 0 ? undefined : "Tem de ser um número inteiro positivo"),
    })
  );

  const dev = await addDeveloper(LOCAL_TENANT_ID, { name, phone, priority: Number(priorityStr) });
  p.log.success(`Adicionado: ${dev.name} (${dev.phone}), prioridade ${dev.priority}, id ${dev._id}`);
}

async function removeDeveloperFlow() {
  const devs = await listDevelopers(LOCAL_TENANT_ID, false);
  if (devs.length === 0) {
    p.log.warn("Equipa vazia, nada para remover.");
    return;
  }
  const id = bail<string>(
    await p.select({
      message: "Quem remover?",
      options: devs.map((d) => ({ value: d._id, label: `${d.name} — ${d.phone}` })),
    })
  );
  await removeDeveloper(LOCAL_TENANT_ID, id);
  p.log.success("Removido.");
}

async function listDevelopersFlow() {
  const devs = await listDevelopers(LOCAL_TENANT_ID, false);
  if (devs.length === 0) {
    p.log.info("Equipa vazia.");
    return;
  }
  const lines = devs.map(
    (d) =>
      `${d.active ? "✓" : "✗"} [prioridade ${d.priority}] ${d.name} — ${d.phone}`
  );
  p.note(lines.join("\n"), "Equipa (ordem de contacto)");
}

function bail<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    p.cancel("Operação cancelada.");
    throw new Error("cancelled");
  }
  return value as T;
}
