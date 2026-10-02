import crypto from "node:crypto";
import { accountsDb } from "./couch.js";
import { createTenant, revokeTenant, type TenantDoc } from "./tenantRepo.js";

const sessionLifetimeMs = 30 * 24 * 60 * 60 * 1000;
const passwordBytes = 64;

export interface AccountDoc {
  _id: string;
  _rev?: string;
  type: "account";
  name: string;
  email: string;
  passwordSalt: string;
  passwordHash: string;
  tenantId: string;
  createdAt: number;
}

interface SessionDoc {
  _id: string;
  _rev?: string;
  type: "session";
  accountId: string;
  expiresAt: number;
}

function emailId(email: string): string {
  return `account:${crypto.createHash("sha256").update(email).digest("hex")}`;
}

function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function derivePassword(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, passwordBytes, (err, key) => err ? reject(err) : resolve(key));
  });
}

export async function registerAccount(input: {
  name: string;
  email: string;
  password: string;
  phone: string;
}): Promise<{ account: AccountDoc; apiKey: string }> {
  const email = input.email.trim().toLowerCase();
  const id = emailId(email);
  const passwordSalt = crypto.randomBytes(16).toString("hex");
  const passwordHash = (await derivePassword(input.password, passwordSalt)).toString("hex");
  const pending = {
    _id: id, type: "account" as const, name: input.name.trim(), email,
    passwordSalt, passwordHash, tenantId: "", createdAt: Date.now(),
  };

  let insertedRev: string;
  try {
    const result = await accountsDb.insert(pending);
    insertedRev = result.rev;
  } catch (err) {
    if ((err as { statusCode?: number })?.statusCode === 409) {
      throw Object.assign(new Error("An account with this email already exists."), { statusCode: 409 });
    }
    throw err;
  }

  let created: Awaited<ReturnType<typeof createTenant>> | undefined;
  try {
    created = await createTenant({
      name: input.name.trim(), language: "en-US",
      primaryDeveloperName: input.name.trim(), primaryDeveloperPhone: input.phone,
    });
    const account: AccountDoc = { ...pending, tenantId: created.tenant._id, _rev: insertedRev };
    const result = await accountsDb.insert(account as unknown as Record<string, unknown>);
    return { account: { ...account, _rev: result.rev }, apiKey: created.apiKey };
  } catch (err) {
    if (created) await revokeTenant(created.tenant._id).catch(() => undefined);
    const doc = await accountsDb.get(id).catch(() => null);
    if (doc) await accountsDb.destroy(id, doc._rev).catch(() => undefined);
    throw err;
  }
}

export async function authenticateAccount(emailInput: string, password: string): Promise<AccountDoc | null> {
  const id = emailId(emailInput.trim().toLowerCase());
  let account: AccountDoc;
  try {
    account = await accountsDb.get(id) as unknown as AccountDoc;
  } catch (err) {
    if ((err as { statusCode?: number })?.statusCode === 404) return null;
    throw err;
  }
  if (!account.tenantId) return null;
  const actual = await derivePassword(password, account.passwordSalt);
  const expected = Buffer.from(account.passwordHash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected) ? account : null;
}

export async function createAccountSession(account: AccountDoc): Promise<string> {
  const token = crypto.randomBytes(64).toString("base64url");
  const hash = tokenHash(token);
  const session: SessionDoc = {
    _id: `session:${hash}`, type: "session", accountId: account._id,
    expiresAt: Date.now() + sessionLifetimeMs,
  };
  await accountsDb.insert(session as unknown as Record<string, unknown>);
  return token;
}

export async function getAccountForSession(token: string): Promise<AccountDoc | null> {
  const id = `session:${tokenHash(token)}`;
  try {
    const session = await accountsDb.get(id) as unknown as SessionDoc;
    if (session.type !== "session" || session.expiresAt <= Date.now()) {
      await accountsDb.destroy(id, session._rev!).catch(() => undefined);
      return null;
    }
    return await accountsDb.get(session.accountId) as unknown as AccountDoc;
  } catch (err) {
    if ((err as { statusCode?: number })?.statusCode === 404) return null;
    throw err;
  }
}

export async function deleteAccountSession(token: string): Promise<void> {
  const id = `session:${tokenHash(token)}`;
  try {
    const doc = await accountsDb.get(id);
    await accountsDb.destroy(id, doc._rev as string);
  } catch (err) {
    if ((err as { statusCode?: number })?.statusCode !== 404) throw err;
  }
}

export function publicAccount(account: AccountDoc, tenant: TenantDoc) {
  return { id: account._id, name: account.name, email: account.email, tenantId: tenant._id, teamName: tenant.name, targetVersion: tenant.targetVersion ?? null, createdAt: account.createdAt };
}

export const accountSessionMaxAgeSeconds = sessionLifetimeMs / 1000;
