/**
 * A tiny, dependency-free router that runs inside a Next.js Route Handler.
 *
 * The original API was an Express 5 app. Rather than hand-rewriting ~60
 * endpoints (and risking subtle behaviour changes in the VAT / stock-book
 * business rules), the route modules keep their Express-style shape
 * (`router.get("/vehicles/:id", requireAuth, handler)`) and this module
 * provides the small slice of the Express API they actually use:
 *
 *   req.params / req.query / req.body / req.headers / req.get() / req.ip /
 *   req.protocol / req.userId / req.log
 *   res.status() / res.json() / res.send() / res.sendStatus() / res.setHeader()
 *   res.end() / res.redirect() / res.stream()
 *
 * It works on the Web-standard Request/Response objects, so it runs the same on
 * Node and on Cloudflare Workers (via OpenNext).
 */
import { logger, type Logger } from "./lib/logger";

export type Params = Record<string, string>;

export interface Request {
  method: string;
  /** Path relative to the /api mount, e.g. "/vehicles/12". */
  path: string;
  url: string;
  params: Params;
  query: Record<string, string | undefined>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  headers: Record<string, string | undefined>;
  get(name: string): string | undefined;
  ip: string | undefined;
  protocol: string;
  /** Data-scope tenant id, set by requireAuth/requireAdmin. */
  userId?: string;
  /** Real signed-in Clerk user id, set by the auth layer. */
  sessionUserId?: string | null;
  log: Logger;
  /** The underlying Web request (for streaming bodies). */
  raw: globalThis.Request;
}

export interface Response {
  statusCode: number;
  headersSent: boolean;
  status(code: number): Response;
  json(body: unknown): void;
  send(body?: BodyInit | null): void;
  sendStatus(code: number): void;
  setHeader(name: string, value: string): Response;
  end(): void;
  redirect(url: string, code?: number): void;
  /** Send a streamed / binary body. */
  stream(body: ReadableStream | Blob | ArrayBuffer | Uint8Array | null): void;
}

export type NextFunction = (err?: unknown) => void;

export type Handler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => void | Promise<void>;

interface Layer {
  method: string | null; // null = middleware (`use`)
  prefix: boolean;
  regex: RegExp;
  keys: string[];
  handlers: Array<Handler | Router>;
}

// Convert an Express-style path ("/vehicles/:id", "/objects/*path") to a regex.
function compile(path: string, prefix: boolean): { regex: RegExp; keys: string[] } {
  const keys: string[] = [];
  let pattern = "";
  for (const seg of path.split("/").filter(Boolean)) {
    if (seg.startsWith(":")) {
      keys.push(seg.slice(1));
      pattern += "/([^/]+)";
    } else if (seg.startsWith("*")) {
      keys.push(seg.slice(1) || "wildcard");
      pattern += "/(.+)";
    } else {
      pattern += "/" + seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  const regex = prefix
    ? new RegExp(`^${pattern}(?=/|$)`, "i")
    : new RegExp(`^${pattern || ""}/?$`, "i");
  return { regex, keys };
}

export class Router {
  private layers: Layer[] = [];

  private add(method: string | null, path: string, handlers: Array<Handler | Router>) {
    const prefix = method === null;
    const { regex, keys } = compile(path, prefix);
    this.layers.push({ method, prefix, regex, keys, handlers });
  }

  use(...args: Array<string | Handler | Router>): this {
    let path = "/";
    if (typeof args[0] === "string") path = args.shift() as string;
    this.add(null, path, args as Array<Handler | Router>);
    return this;
  }
  get(path: string, ...h: Handler[]): this { this.add("GET", path, h); return this; }
  post(path: string, ...h: Handler[]): this { this.add("POST", path, h); return this; }
  put(path: string, ...h: Handler[]): this { this.add("PUT", path, h); return this; }
  patch(path: string, ...h: Handler[]): this { this.add("PATCH", path, h); return this; }
  delete(path: string, ...h: Handler[]): this { this.add("DELETE", path, h); return this; }

  /**
   * Runs the request through this router. Resolves true if a handler sent a
   * response, false if nothing matched (so the caller can 404).
   */
  async dispatch(req: Request, res: InternalResponse, path = req.path): Promise<boolean> {
    for (const layer of this.layers) {
      if (res.headersSent) return true;
      if (layer.method && layer.method !== req.method) {
        // HEAD falls through to GET like Express.
        if (!(layer.method === "GET" && req.method === "HEAD")) continue;
      }
      const m = layer.regex.exec(path);
      if (!m) continue;

      const params: Params = { ...req.params };
      layer.keys.forEach((k, i) => {
        const v = m[i + 1];
        if (v !== undefined) params[k] = decodeURIComponent(v);
      });
      req.params = params;

      for (const h of layer.handlers) {
        if (res.headersSent) return true;
        if (h instanceof Router) {
          const rest = layer.prefix ? path.slice(m[0].length) || "/" : path;
          if (await h.dispatch(req, res, rest)) return true;
          continue;
        }
        let calledNext = false;
        let nextErr: unknown;
        await h(req, res, (err?: unknown) => {
          calledNext = true;
          nextErr = err;
        });
        if (nextErr) throw nextErr;
        if (res.headersSent) return true;
        if (!calledNext) {
          // Handler neither responded nor called next(); for a route layer that
          // means it finished without sending — treat as handled (Express would
          // hang). Middleware layers must call next().
          if (layer.method) return true;
          return true;
        }
      }
    }
    return res.headersSent;
  }
}

export interface InternalResponse extends Response {
  toResponse(): globalThis.Response;
}

export function createResponse(): InternalResponse {
  const headers = new Headers();
  let body: BodyInit | null = null;
  const res: InternalResponse = {
    statusCode: 200,
    headersSent: false,
    status(code) {
      res.statusCode = code;
      return res;
    },
    setHeader(name, value) {
      headers.set(name, value);
      return res;
    },
    json(payload) {
      if (!headers.has("content-type")) headers.set("content-type", "application/json; charset=utf-8");
      body = JSON.stringify(payload ?? null);
      res.headersSent = true;
    },
    send(payload) {
      body = payload ?? null;
      res.headersSent = true;
    },
    sendStatus(code) {
      res.statusCode = code;
      body = null;
      res.headersSent = true;
    },
    end() {
      res.headersSent = true;
    },
    redirect(url, code = 302) {
      res.statusCode = code;
      headers.set("location", url);
      res.headersSent = true;
    },
    stream(payload) {
      body = payload as BodyInit | null;
      res.headersSent = true;
    },
    toResponse() {
      const noBody = res.statusCode === 204 || res.statusCode === 304;
      return new globalThis.Response(noBody ? null : body, {
        status: res.statusCode,
        headers,
      });
    },
  };
  return res;
}

const BODY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Build the Express-like request object from a Web Request. */
export async function createRequest(
  raw: globalThis.Request,
  mountPath = "/api",
  opts: { parseBody?: (path: string, method: string) => boolean } = {},
): Promise<Request> {
  const url = new URL(raw.url);
  let path = url.pathname;
  if (path.toLowerCase().startsWith(mountPath)) path = path.slice(mountPath.length) || "/";

  const headers: Record<string, string | undefined> = {};
  raw.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });

  const query: Record<string, string | undefined> = {};
  url.searchParams.forEach((v, k) => {
    if (!(k in query)) query[k] = v;
  });

  let body: unknown = undefined;
  const method = raw.method.toUpperCase();
  const shouldParse = opts.parseBody ? opts.parseBody(path, method) : true;
  if (BODY_METHODS.has(method) && shouldParse) {
    const ct = (headers["content-type"] ?? "").toLowerCase();
    try {
      if (ct.includes("application/json")) {
        const text = await raw.text();
        body = text ? JSON.parse(text) : {};
      } else if (ct.includes("application/x-www-form-urlencoded")) {
        body = Object.fromEntries(new URLSearchParams(await raw.text()));
      }
    } catch {
      body = undefined;
      (headers as Record<string, string>)["x-body-parse-error"] = "1";
    }
  }

  const forwardedFor = headers["x-forwarded-for"]?.split(",")[0]?.trim();
  const ip = headers["cf-connecting-ip"] || forwardedFor || headers["x-real-ip"] || undefined;
  const protocol =
    headers["x-forwarded-proto"]?.split(",")[0]?.trim() || url.protocol.replace(":", "");

  return {
    method,
    path,
    url: url.pathname + url.search,
    params: {},
    query,
    body: body ?? {},
    headers,
    get(name: string) {
      return headers[name.toLowerCase()];
    },
    ip,
    protocol,
    log: logger,
    raw,
  };
}
