import { Router } from "../http";
import { HealthCheckResponse } from "@workspace/api-zod";

const router = new Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

export default router;
