import Nano from "nano";
import { config } from "../config.js";
import { createLogger } from "../logger.js";

const logger = createLogger("couchdb");
const nano = Nano(config.couchdb.url);

async function ensureDb(name: string) {
  try {
    await nano.db.create(name);
    logger.info({ db: name }, "Base de dados CouchDB criada");
  } catch (err: unknown) {
    // 412 = a base de dados já existe, não é um erro real.
    const statusCode = (err as { statusCode?: number })?.statusCode;
    if (statusCode !== 412) {
      logger.error({ err, db: name }, "Falha ao garantir base de dados CouchDB");
      throw err;
    }
  }
  return nano.db.use(name);
}

// Ligação estabelecida uma vez, partilhada por todos os repositórios.
// Nota sobre escalabilidade horizontal: qualquer número de instâncias deste
// processo (vários hooks em várias máquinas ou servidores
// de webhooks replicados) pode ler/escrever nestas bases de dados em
// simultâneo — o CouchDB trata da concorrência via MVCC (campo `_rev`).
export const activityDb = await ensureDb(config.couchdb.activityDb);
export const approvalsDb = await ensureDb(config.couchdb.approvalsDb);
export const teamDb = await ensureDb(config.couchdb.teamDb);
export const classificationCacheDb = await ensureDb(config.couchdb.classificationCacheDb);
export const tenantsDb = await ensureDb(config.couchdb.tenantsDb);
