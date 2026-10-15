import { Router } from "../http";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db } from "@workspace/db";

const router = new Router();

// Used by uptime checks and by the rollout pipeline, which waits for this to
// report the release it just deployed with a working database.
router.get("/healthz", async (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  let database = "ok";
  try {
    await db.ping();
  } catch {
    database = "unreachable";
  }
  res.status(database === "ok" ? 200 : 503).json({ ...data, release: process.env.RELEASE || null, database });
});

export default router;
