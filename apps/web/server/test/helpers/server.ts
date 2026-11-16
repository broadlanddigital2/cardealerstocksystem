// Runs our API routers on a local port for tests (in place of an Express app),
// going through the same request/response handling as production.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Router, createRequest, createResponse } from "../../http";

export interface TestServer {
  base: string;
  request(path: string, method?: string, body?: object): Promise<globalThis.Response>;
  close(): Promise<void>;
}

export async function startTestServer(routers: Router[]): Promise<TestServer> {
  const root = new Router();
  for (const r of routers) root.use(r);
  const server: Server = createServer(async (incoming, outgoing) => {
    const chunks: Buffer[] = [];
    for await (const c of incoming) chunks.push(c as Buffer);
    const method = (incoming.method ?? "GET").toUpperCase();
    const headers = new Headers();
    for (const [k, v] of Object.entries(incoming.headers)) {
      if (typeof v === "string") headers.set(k, v);
      else if (Array.isArray(v)) headers.set(k, v.join(", "));
    }
    const raw = new Request(`http://127.0.0.1${incoming.url ?? "/"}`, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : Buffer.concat(chunks),
    });
    const req = await createRequest(raw, "/api");
    const res = createResponse();
    try {
      if (!(await root.dispatch(req, res))) res.status(404).json({ error: "Not found" });
    } catch {
      res.status(500).json({ error: "Test request failed" });
    }
    const out = res.toResponse();
    outgoing.statusCode = out.status;
    out.headers.forEach((v, k) => outgoing.setHeader(k, v));
    outgoing.end(Buffer.from(await out.arrayBuffer()));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    request: (path, method = "GET", body) =>
      fetch(`${base}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}
