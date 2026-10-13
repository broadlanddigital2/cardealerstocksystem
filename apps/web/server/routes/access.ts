import { Router } from "../http";
import { getSessionUserId, getUserEmail, isEmailAllowed, isEmailAdmin } from "../middlewares/requireAuth";
import { getSiteModules, modulesFor } from "../lib/modules";

// Reports whether the currently signed-in user is allowed into the shared stock
// book, and which modules they can use. Unlike the rest of the API this route
// is NOT gated by the allowlist itself — it only requires a valid signed-in
// session — so that a signed-in but not-yet-invited user can be shown a clear
// "no access" screen with their email.
const router = new Router();

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
  const [modules, siteModules] = allowed
    ? await Promise.all([modulesFor(isAdmin), getSiteModules()])
    : [[], []];
  res.json({ email, allowed, isAdmin, modules, siteModules });
});

export default router;
