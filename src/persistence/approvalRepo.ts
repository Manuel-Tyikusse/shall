import { nanoid } from "nanoid";
import { approvalsDb } from "./couch.js";
import { recordActivity } from "./activityRepo.js";
import type { ApprovalChannel, ApprovalDecision, ContactMethod, RiskAssessment } from "../types.js";

export interface ApprovalDoc {
  _id: string;
  _rev?: string;
  type: "approval";
  tenantId: string;
  command: string;
  cwd: string;
  agentLabel: string;
  assessment: RiskAssessment;
  channel: ApprovalChannel;
  status: "pending" | ApprovalDecision;
  transcript: string[];
  contacted: { developerId: string; method: ContactMethod; at: number }[];
  createdAt: number;
  /** Tempo máximo de espera (ms), decidido na criação consoante o canal — permite calcular o timeout sem depender do config em cada leitura. */
  timeoutMs: number;
  decidedAt?: number;
  decidedBy?: string;
}

export async function createApproval(
  input: Pick<ApprovalDoc, "tenantId" | "command" | "cwd" | "agentLabel" | "assessment" | "channel" | "createdAt" | "timeoutMs">
): Promise<ApprovalDoc> {
  const doc: ApprovalDoc = {
    _id: nanoid(10),
    type: "approval",
    status: "pending",
    transcript: [],
    contacted: [],
    ...input,
  };
  const res = await approvalsDb.insert(doc);
  return { ...doc, _rev: res.rev };
}

export async function getApproval(id: string): Promise<ApprovalDoc> {
  return approvalsDb.get(id) as Promise<ApprovalDoc>;
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MAX_PATCH_RETRIES = 5;

/**
 * Aplica `mutate` a um documento e grava, com retry em caso de conflito de
 * escrita concorrente (409). Cada tentativa volta a ler o documento antes de
 * reaplicar a mutação, com backoff exponencial + jitter.
 */
async function patchApproval(id: string, mutate: (doc: ApprovalDoc) => void, attempt = 0): Promise<ApprovalDoc> {
  const doc = await getApproval(id);
  mutate(doc);
  try {
    const res = await approvalsDb.insert(doc);
    return { ...doc, _rev: res.rev };
  } catch (err: unknown) {
    const statusCode = (err as { statusCode?: number })?.statusCode;
    if (statusCode === 409 && attempt < MAX_PATCH_RETRIES) {
      const backoffMs = 50 * 2 ** attempt + Math.random() * 50;
      await sleep(backoffMs);
      return patchApproval(id, mutate, attempt + 1);
    }
    throw err;
  }
}
export { patchApproval };

export async function appendContact(id: string, developerId: string, method: ContactMethod) {
  return patchApproval(id, (doc) => {
    doc.contacted.push({ developerId, method, at: Date.now() });
  });
}

export async function appendTranscript(id: string, text: string) {
  return patchApproval(id, (doc) => {
    doc.transcript.push(text);
  });
}

/**
 * Regista a decisão e, se esta for a transição que efetivamente resolve o
 * pedido (ignora se já tiver sido decidido entretanto por outro canal),
 * grava também o resultado final no log de atividade — este é o único
 * sítio onde isso acontece, para não duplicar entradas por cada poll.
 */
export async function decide(id: string, decision: "approved" | "denied", developerId?: string): Promise<ApprovalDoc> {
  let transitioned = false;
  const result = await patchApproval(id, (doc) => {
    if (doc.status !== "pending") return;
    transitioned = true;
    const expired = Date.now() - doc.createdAt >= doc.timeoutMs;
    doc.status = expired ? "timeout" : decision;
    doc.decidedAt = Date.now();
    if (!expired) doc.decidedBy = developerId;
  });
  if (transitioned) {
    await recordActivity({
      tenantId: result.tenantId,
      timestamp: Date.now(),
      command: result.command,
      cwd: result.cwd,
      agentLabel: result.agentLabel,
      assessment: result.assessment,
      outcome: result.status === "approved" ? "approved" : "denied",
    });
  }
  return result;
}

export async function markTimeout(id: string): Promise<ApprovalDoc> {
  let transitioned = false;
  const result = await patchApproval(id, (doc) => {
    if (doc.status !== "pending") return; // já decidido entretanto, não sobrescrever
    transitioned = true;
    doc.status = "timeout";
    doc.decidedAt = Date.now();
  });
  if (transitioned) {
    await recordActivity({
      tenantId: result.tenantId,
      timestamp: Date.now(),
      command: result.command,
      cwd: result.cwd,
      agentLabel: result.agentLabel,
      assessment: result.assessment,
      outcome: "denied",
    });
  }
  return result;
}

/**
 * Varre as aprovações pendentes deste tenant que já contactaram este
 * developer (por SMS ou chamada) e devolve a mais recente. Usado quando
 * chega uma resposta por SMS, para saber a que pedido ela se refere.
 */
export async function findLatestPendingContactedDeveloper(
  tenantId: string,
  developerId: string
): Promise<ApprovalDoc | undefined> {
  const all = await approvalsDb.list({ include_docs: true });
  return all.rows
    .map((r) => r.doc as unknown as ApprovalDoc)
    .filter(
      (d) =>
        d?.type === "approval" &&
        d.tenantId === tenantId &&
        d.status === "pending" &&
        d.contacted.some((c) => c.developerId === developerId)
    )
    .sort((a, b) => b.createdAt - a.createdAt)[0];
}
