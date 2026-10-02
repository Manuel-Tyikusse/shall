import { releasesDb } from "./couch.js";

export interface ReleaseDoc {
  _id: string;
  _rev?: string;
  type: "release";
  version: string;
  channel: "beta" | "stable";
  notes: string;
  downloadUrl?: string;
  createdAt: number;
}

export async function listReleases(): Promise<ReleaseDoc[]> {
  const result = await releasesDb.list({ include_docs: true });
  return result.rows
    .map((row) => row.doc as unknown as ReleaseDoc)
    .filter((doc) => doc?.type === "release")
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function createRelease(input: Omit<ReleaseDoc, "_id" | "_rev" | "type" | "createdAt">): Promise<ReleaseDoc> {
  const id = `release:${input.version}`;
  const doc: ReleaseDoc = { _id: id, type: "release", createdAt: Date.now(), ...input };
  try {
    const previous = await releasesDb.get(id) as unknown as ReleaseDoc;
    const updated = { ...previous, ...doc, _rev: previous._rev };
    const result = await releasesDb.insert(updated as unknown as Record<string, unknown>);
    return { ...updated, _rev: result.rev };
  } catch (err) {
    if ((err as { statusCode?: number })?.statusCode !== 404) throw err;
    const result = await releasesDb.insert(doc as unknown as Record<string, unknown>);
    return { ...doc, _rev: result.rev };
  }
}

export async function findRelease(version: string): Promise<ReleaseDoc | null> {
  try {
    return await releasesDb.get(`release:${version}`) as unknown as ReleaseDoc;
  } catch (err) {
    if ((err as { statusCode?: number })?.statusCode === 404) return null;
    throw err;
  }
}
