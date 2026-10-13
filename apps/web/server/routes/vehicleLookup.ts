import { Router } from "../http";
import { requireModule } from "../lib/modules";
import { LookupVehicleBody, LookupVehicleResponse } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { lookupRapidCarCheck, VehicleLookupError } from "../lib/rapidCarCheck";

const router = new Router();

router.post("/vehicle-lookup", requireAuth, requireModule("reg_lookup"), async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  const parsed = LookupVehicleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid UK registration." });
    return;
  }
  try {
    const details = await lookupRapidCarCheck(parsed.data.registrationNumber);
    res.json(LookupVehicleResponse.parse(details));
  } catch (error) {
    const status = error instanceof VehicleLookupError ? error.status : 502;
    const message = error instanceof VehicleLookupError
      ? error.message
      : "Unable to look up this registration. You can still enter the details manually.";
    // Never include the upstream URL, raw response or Error/cause in logs.
    req.log.warn({ status }, "Registration lookup did not return vehicle details");
    if (status === 429) res.setHeader("Retry-After", "60");
    res.status(status).json({ error: message });
  }
});

export default router;