// Minimal structured logger with a pino-compatible call shape
// (`logger.info({ ...fields }, "message")`). pino relies on Node worker threads
// for transports, which are unavailable on Cloudflare Workers, so we log
// single-line JSON to the console instead — Workers Observability and `wrangler
// tail` index these automatically.

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const lvl = (process.env.LOG_LEVEL ?? "info").toLowerCase() as Level;
  return ORDER[lvl] ?? ORDER.info;
}

function serialize(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

export interface Logger {
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
  child(bindings: Record<string, unknown>): Logger;
}

function make(bindings: Record<string, unknown>): Logger {
  const emit = (level: Level, obj: unknown, msg?: string) => {
    if (ORDER[level] < threshold()) return;
    let fields: Record<string, unknown> = {};
    let message = msg;
    if (typeof obj === "string") {
      message = obj;
    } else if (obj && typeof obj === "object") {
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        fields[k] = serialize(v);
      }
    }
    fields = { level, time: new Date().toISOString(), ...bindings, ...fields, msg: message };
    const line = JSON.stringify(fields);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  };
  return {
    debug: (o, m) => emit("debug", o, m),
    info: (o, m) => emit("info", o, m),
    warn: (o, m) => emit("warn", o, m),
    error: (o, m) => emit("error", o, m),
    child: (b) => make({ ...bindings, ...b }),
  };
}

export const logger: Logger = make({});
