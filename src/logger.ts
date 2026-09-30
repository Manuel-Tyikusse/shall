import pino from "pino";


export const logger = process.env.PINO_JSON
  ? pino({ level: process.env.LOG_LEVEL ?? "info" }, pino.destination(2))
  : pino({
      level: process.env.LOG_LEVEL ?? "info",
      transport: {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname", destination: 2 },
      },
    });

/** Cria um logger filho com um campo "mod" fixo, para identificar a origem do log. */
export function createLogger(mod: string) {
  return logger.child({ mod });
}
