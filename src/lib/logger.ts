/**
 * Minimal structured logger (§5 observability). Emits one JSON line per event so
 * logs are greppable in Vercel/CloudWatch. Swap the sink here if we adopt a
 * hosted logger later — call sites won't change.
 */
type Level = "debug" | "info" | "warn" | "error";

type Meta = Record<string, unknown>;

function emit(level: Level, msg: string, meta?: Meta): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...meta });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, meta?: Meta) => emit("debug", msg, meta),
  info: (msg: string, meta?: Meta) => emit("info", msg, meta),
  warn: (msg: string, meta?: Meta) => emit("warn", msg, meta),
  error: (msg: string, meta?: Meta) => emit("error", msg, meta),
};
