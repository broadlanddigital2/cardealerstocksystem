import { createRequest, createResponse } from "./http";
import router from "./routes";
import { logger } from "./lib/logger";
import { getSessionUser } from "./lib/session";
import { rememberSessionEmail } from "./middlewares/requireAuth";

function sameOrigin(raw: Request): boolean {
  const origin = raw.headers.get("origin");
  if (!origin || origin === "null") return !origin;
  try {
    return new URL(origin).host === new URL(raw.url).host;
  } catch {
    return false;
  }
}

/**
 * Entry point for every /api/* request (wired up in app/api/[[...path]]/route.ts).
 * Resolves the signed-in session (cookie), then runs the Express-style route modules.
 */
export async function handleApiRequest(raw: Request): Promise<Response> {
  {
    const req = await createRequest(raw, "/api");
    const res = createResponse();
    try {
      const user = await getSessionUser(req.headers);
      req.sessionUserId = user?.id ?? null;
      if (user) rememberSessionEmail(user.id, user.email);

      // The session is a cookie, so refuse changes sent from other websites'
      // pages (cross-site request forgery). Browsers always send Origin on
      // cross-site POST/PUT/PATCH/DELETE; server-to-server calls have none.
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !sameOrigin(raw)) {
        res.status(403).json({ error: "Cross-site request refused" });
        return res.toResponse();
      }

      if (req.headers["x-body-parse-error"]) {
        res.status(400).json({ error: "Invalid JSON body" });
        return res.toResponse();
      }

      const handled = await router.dispatch(req, res);
      if (!handled) res.status(404).json({ error: "Not found" });
    } catch (err) {
      logger.error({ err, method: req.method, path: req.path }, "Unhandled API error");
      if (!res.headersSent) {
        // Operators can see the underlying error by passing ?debug=<CRON_SECRET>.
        const secret = process.env.CRON_SECRET;
        const debug = Boolean(secret) && new URL(raw.url).searchParams.get("debug") === secret;
        res.status(500).json(
          debug
            ? { error: "Internal Server Error", detail: err instanceof Error ? `${err.name}: ${err.message}` : String(err), cause: err instanceof Error && err.cause ? String(err.cause) : undefined }
            : { error: "Internal Server Error" },
        );
      }
    }
    return res.toResponse();
  }
}
