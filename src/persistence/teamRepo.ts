import { nanoid } from "nanoid";
import { teamDb } from "./couch.js";

export interface Developer {
  _id: string;
  _rev?: string;
  type: "developer";
  tenantId: string;
  name: string;
  phone: string;
  /** Ordem de contacto: menor número = contactado primeiro. */
  priority: number;
  active: boolean;
}

export async function addDeveloper(
  tenantId: string,
  input: { name: string; phone: string; priority: number }
): Promise<Developer> {
  const doc: Developer = { _id: nanoid(8), type: "developer", tenantId, active: true, ...input };
  const res = await teamDb.insert(doc as unknown as Record<string, unknown>);
  return { ...doc, _rev: res.rev };
}

/** Lista ordenada por prioridade (quem é contactado primeiro aparece primeiro), só deste tenant. */
export async function listDevelopers(tenantId: string, activeOnly = true): Promise<Developer[]> {
  const all = await teamDb.list({ include_docs: true });
  return all.rows
    .map((r) => r.doc as unknown as Developer)
    .filter((d) => d?.type === "developer" && d.tenantId === tenantId && (!activeOnly || d.active))
    .sort((a, b) => a.priority - b.priority);
}

/**
 * Procura por telefone SEM filtrar por tenant — usado quando chega um SMS e
 * ainda não sabemos a que cliente pertence (o Twilio não nos diz o tenant).
 * O `tenantId` do developer encontrado é depois usado para tudo o resto.
 * Se o número estiver associado a mais de um developer ativo, a pesquisa
 * falha fechada em vez de escolher um tenant arbitrariamente.
 */
export async function findByPhoneAcrossTenants(phone: string): Promise<Developer | undefined> {
  const all = await teamDb.list({ include_docs: true });
  const matches = all.rows
    .map((r) => r.doc as unknown as Developer)
    .filter((d) => d?.type === "developer" && d.active && d.phone === phone);
  return matches.length === 1 ? matches[0] : undefined;
}

export async function removeDeveloper(tenantId: string, id: string): Promise<void> {
  const doc = await teamDb.get(id);
  if ((doc as unknown as Developer).tenantId !== tenantId) {
    throw Object.assign(new Error("developer não pertence a este tenant"), { statusCode: 404 });
  }
  await teamDb.destroy(id, doc._rev as string);
}
