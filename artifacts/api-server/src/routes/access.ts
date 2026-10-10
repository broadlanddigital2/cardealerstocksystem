import { Router, type IRouter } from "express";
import { getSessionUserId, getUserEmail, isEmailAllowed, isEmailAdmin } from "../middlewares/requireAuth";

// Reports whether the currently signed-in user is allowed into the shared stock
// book. Unlike the rest of the API this route is NOT gated by the allowlist
// itself — it only requires a valid Clerk session — so that a signed-in but
// not-yet-invited user can be shown a clear "no access" screen with their email.
const router: IRouter = Router();

router.get("/access", async (req, res) => {
  const sessionUserId = getSessionUserId(req);
  if (!sessionUserId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const email = await getUserEmail(sessionUserId);
  const [allowed, isAdmin] = await Promise.all([
    isEmailAllowed(email),
    isEmailAdmin(email),
  ]);
  res.json({ email, allowed, isAdmin });
});

export default router;
