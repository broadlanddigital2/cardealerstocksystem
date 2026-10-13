import { Router } from "../http";
import { requireAdmin } from "../middlewares/requireAuth";
import {
  getSiteModules,
  getStaffModules,
  setSiteModules,
  setStaffModules,
} from "../lib/modules";

// GET/PUT /roles            the dealer's admin chooses which of the site's
//                           modules the Staff role may use (Settings -> Roles).
// GET/PUT /platform/modules which modules this dealer has. Broadland Digital
//                           only: Authorization: Bearer <PLATFORM_SECRET>
//                           (used by the central console; not a dealer setting).
const router = new Router();

router.use("/roles", requireAdmin);

router.get("/roles", async (_req, res): Promise<void> => {
  const [siteModules, staff] = await Promise.all([getSiteModules(), getStaffModules()]);
  res.json({ siteModules, roles: { admin: siteModules, staff } });
});

router.put("/roles", async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as { staff?: unknown };
  if (!Array.isArray(body.staff)) {
    res.status(400).json({ error: "Send { staff: [module keys] }." });
    return;
  }
  const site = await getSiteModules();
  // Staff can only be given modules the site has.
  const saved = await setStaffModules(body.staff.filter((k) => site.includes(k as never)));
  res.json({ siteModules: site, roles: { admin: site, staff: saved } });
});

function platformAuthorised(header: string | undefined): boolean {
  const secret = process.env.PLATFORM_SECRET;
  if (!secret || secret.length < 32 || !header) return false;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  const given = m?.[1]?.trim() ?? "";
  if (given.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}

router.get("/platform/modules", async (req, res): Promise<void> => {
  if (!platformAuthorised(req.get("authorization"))) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ enabled: await getSiteModules() });
});

router.put("/platform/modules", async (req, res): Promise<void> => {
  if (!platformAuthorised(req.get("authorization"))) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const body = (req.body ?? {}) as { enabled?: unknown };
  if (!Array.isArray(body.enabled)) {
    res.status(400).json({ error: "Send { enabled: [module keys] }." });
    return;
  }
  res.json({ enabled: await setSiteModules(body.enabled) });
});

export default router;
