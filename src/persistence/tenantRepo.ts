import crypto from "node:crypto";
import { nanoid } from "nanoid";
import { tenantsDb } from "./couch.js";
import { addDeveloper } from "./teamRepo.js";

export interface TenantDoc {
  _id: string;
  _rev?: string;
  type: "tenant";
  name: string;
  /** Código BCP-47 (ex: "pt-PT", "en-US"), usado no <Say>/<Gather> do Twilio e como dica ao intérprete de decisões. */
  language: string;
  apiKeyHash: string;
  /** Só os primeiros caracteres, para identificar a chave em listagens sem a poder reconstruir. */
  apiKeyPrefix: string;
  active: boolean;
  createdAt: number;
  targetVersion?: string;
}

function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export interface CreateTenantInput {
  name: string;
  language?: string;
  /**
   * O telefone principal (E.164) é obrigatório no registo — sem pelo menos
   * um contacto não há forma de pedir aprovação a ninguém. Fica gravado
   * como o primeiro membro da equipa (prioridade 1), não como um campo
   * solto no tenant, para que toda a lógica de rotação/contacto continue a
   * usar uma única fonte de verdade (a equipa).
   */
  primaryDeveloperName: string;
  primaryDeveloperPhone: string;
}

/** Gera uma nova chave de API — só é devolvida esta vez; só o hash fica persistido. */
export async function createTenant(input: CreateTenantInput): Promise<{ tenant: TenantDoc; apiKey: string }> {
  const apiKey = `agk_${crypto.randomBytes(24).toString("hex")}`;
  const doc: TenantDoc = {
    _id: nanoid(12),
    type: "tenant",
    name: input.name,
    language: input.language ?? "pt-PT",
    apiKeyHash: hashApiKey(apiKey),
    apiKeyPrefix: apiKey.slice(0, 10),
    active: true,
    createdAt: Date.now(),
  };
  await tenantsDb.insert(doc as unknown as Record<string, unknown>);

  await addDeveloper(doc._id, {
    name: input.primaryDeveloperName,
    phone: input.primaryDeveloperPhone,
    priority: 1,
  });

  return { tenant: doc, apiKey };
}

export async function findTenantById(id: string): Promise<TenantDoc | null> {
  try {
    return (await tenantsDb.get(id)) as unknown as TenantDoc;
  } catch (err: unknown) {
    const statusCode = (err as { statusCode?: number })?.statusCode;
    if (statusCode === 404) return null;
    throw err;
  }
}

export async function listTenants(): Promise<TenantDoc[]> {
  const all = await tenantsDb.list({ include_docs: true });
  return all.rows.map((r) => r.doc as unknown as TenantDoc).filter((d) => d?.type === "tenant");
}

export async function revokeTenant(id: string): Promise<void> {
  const doc = await tenantsDb.get(id);
  await tenantsDb.insert({ ...doc, active: false } as unknown as Record<string, unknown>);
}

export async function rotateTenantApiKey(id: string): Promise<string> {
  const tenant = await tenantsDb.get(id) as unknown as TenantDoc;
  const apiKey = `agk_${crypto.randomBytes(24).toString("hex")}`;
  const updated = {
    ...tenant,
    apiKeyHash: hashApiKey(apiKey),
    apiKeyPrefix: apiKey.slice(0, 10),
  };
  await tenantsDb.insert(updated as unknown as Record<string, unknown>);
  return apiKey;
}

/**
 * Usado pelo middleware de autenticação em cada pedido à API. Faz scan a
 * todos os tenants — aceitável para uma quantidade modesta de clientes; com
 * muitos milhares, vale a pena um índice Mango em `apiKeyHash`.
 */
export async function findTenantByApiKey(apiKey: string): Promise<TenantDoc | null> {
  const hash = hashApiKey(apiKey);
  const all = await listTenants();
  return all.find((t) => t.active && t.apiKeyHash === hash) ?? null;
}

export const LOCAL_TENANT_ID = "operator-local";

/** Tenant fixo para uso local do operador (hooks e comandos `team`/`log` nesta máquina). */
export async function ensureLocalOperatorTenant(primaryName: string, primaryPhone: string): Promise<TenantDoc> {
  const existing = await findTenantById(LOCAL_TENANT_ID);
  if (existing) return existing;

  const doc: TenantDoc = {
    _id: LOCAL_TENANT_ID,
    type: "tenant",
    name: "Operador (local)",
    language: "pt-PT",
    apiKeyHash: "",
    apiKeyPrefix: "",
    active: true,
    createdAt: Date.now(),
  };
  await tenantsDb.insert(doc as unknown as Record<string, unknown>);
  await addDeveloper(doc._id, { name: primaryName, phone: primaryPhone, priority: 1 });
  return doc;
}
