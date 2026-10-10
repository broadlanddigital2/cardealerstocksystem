import { withRequestDb } from "@workspace/db";
import { createRequest, createResponse } from "./http";
import router from "./routes";
import { logger } from "./lib/logger";
import { getSessionUser } from "./lib/supabaseAuth";
import { rememberSessionEmail } from "./middlewares/requireAuth";
import { requestDbConnectionString } from "./lib/dbConnection";

/**
 * Entry point for every /api/* request (wired up in app/api/[[...path]]/route.ts).
 * Resolves the Supabase Auth session, then runs the Express-style route modules.
 */
export async function handleApiRequest(raw: Request): Promise<Response> {
  return withRequestDb(async () => {
    const req = await createRequest(raw, "/api");
    const res = createResponse();
    try {
      const user = await getSessionUser(req.headers);
      req.sessionUserId = user?.id ?? null;
      if (user) rememberSessionEmail(user.id, user.email);

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
    const out = res.toResponse();
    // The DB pool for this request closes when withRequestDb returns, so make
    // sure any streamed body that depends on it has been fully produced first.
    return out;
  }, { connectionString: requestDbConnectionString() });
}
