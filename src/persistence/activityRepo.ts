import { nanoid } from "nanoid";
import { activityDb } from "./couch.js";
import type { ActivityLogEntry } from "../types.js";

export async function recordActivity(entry: ActivityLogEntry) {
  const doc = { _id: entry.id ?? nanoid(10), type: "activity" as const, ...entry };
  await activityDb.insert(doc);
}

/**
 * Nota de escala: lê e ordena em memória — aceitável até alguns milhares de
 * entradas por tenant. Para volumes maiores, cria uma view CouchDB indexada
 * por `tenantId` + `timestamp` em vez de `_all_docs`.
 */
export async function getRecentActivity(tenantId: string, limit = 15): Promise<ActivityLogEntry[]> {
  const all = await activityDb.list({ include_docs: true });
  return all.rows
    .map((r) => r.doc as unknown as ActivityLogEntry & { type?: string })
    .filter((d) => d.type === "activity" && d.tenantId === tenantId)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

export async function summarizeForVoice(tenantId: string, limit = 8): Promise<string> {
  const recent = await getRecentActivity(tenantId, limit);
  if (recent.length === 0) return "Ainda não há atividade registada neste projeto.";

  return recent
    .map((e, i) => {
      const when = new Date(e.timestamp).toLocaleTimeString("pt-PT");
      return `${i + 1}. às ${when}, o comando "${e.command}" do agente ${e.agentLabel} ficou com estado ${e.outcome}.`;
    })
    .join(" ");
}
