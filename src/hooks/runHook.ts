import { createInterface } from "node:readline";
import { submitCommand } from "../core/evaluateCommand.js";
import { LOCAL_TENANT_ID } from "../persistence/tenantRepo.js";
import { waitForDecision } from "../approval/wait.js";
import { config } from "../config.js";
import { normalizeHookInput, formatHookDecision, type HookAdapter } from "./adapters.js";
import { createLogger } from "../logger.js";

const logger = createLogger("agent-hook");

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = "";
    const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
    input.on("line", (line) => { text += `${line}\n`; });
    input.on("close", () => resolve(text));
    input.on("error", reject);
  });
}

async function daemonIsReady(): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${config.server.port}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Reads one agent hook event and returns a fail-closed native decision. */
export async function runHook(adapter: HookAdapter): Promise<void> {
  let allowed = false;
  let reason = "Shall não conseguiu avaliar o comando; execução bloqueada por segurança.";
  try {
    const raw = JSON.parse(await readStdin()) as unknown;
    const request = normalizeHookInput(adapter, raw);
    if (!(await daemonIsReady())) {
      throw new Error("O serviço Shall não está ativo. Inicia `shall daemon` antes de usar o hook.");
    }

    const result = await submitCommand(
      LOCAL_TENANT_ID,
      request.command,
      request.cwd,
      request.agentLabel,
    );

    if (!result.requiresApproval) {
      allowed = true;
      reason = "Comando classificado como reversível.";
    } else {
      const decision = await waitForDecision(result.approvalId!);
      allowed = decision.status === "approved";
      reason = allowed
        ? "Comando aprovado pelo developer."
        : `Comando bloqueado: aprovação ${decision.status === "denied" ? "negada" : "não recebida a tempo"}.`;
    }
  } catch (err) {
    reason = err instanceof Error ? err.message : reason;
    logger.error({ err }, "Falha no hook do agente; a bloquear a ação");
  }

  process.stdout.write(`${JSON.stringify(formatHookDecision(adapter, allowed, reason))}\n`);
}

