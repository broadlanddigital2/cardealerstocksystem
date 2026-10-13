import { Router } from "../http";
import { db, appUsersTable } from "@workspace/db";
import { bustUserCache, requireAdmin } from "../middlewares/requireAuth";
import {
  RoleError,
  createRole,
  deleteRole,
  getSiteModules,
  listRoles,
  setSiteModules,
  updateRole,
} from "../lib/modules";

// Roles (admin only, Settings -> Roles):
//   GET    /roles             site modules + every role with its modules
//   POST   /roles             { name, modules }        add a role
//   PATCH  /roles/:key        { name?, modules? }      rename / change modules
//   DELETE /roles/:key        its people move to the default Staff role
// Platform (Broadland Digital only, Authorization: Bearer <PLATFORM_SECRET>):
//   GET/PUT /platform/modules { enabled: [module keys] }  which modules this dealer has
const router = new Router();

router.use("/roles", requireAdmin);

async function rolesPayload() {
  const [siteModules, roles, users] = await Promise.all([
    getSiteModules(),
    listRoles(),
    db.select({ role: appUsersTable.role }).from(appUsersTable),
  ]);
  const counts = new Map<string, number>();
  for (const u of users) counts.set(u.role, (counts.get(u.role) ?? 0) + 1);
  return {
    siteModules,
    roles: roles.map((r) => ({ ...r, userCount: counts.get(r.key) ?? 0 })),
  };
}

function sendRoleError(res: import("../http").Response, err: unknown): boolean {
  if (err instanceof RoleError) {
    res.status(400).json({ error: err.message });
    return true;
  }
  return false;
}

router.get("/roles", async (_req, res): Promise<void> => {
  res.json(await rolesPayload());
});

router.post("/roles", async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as { name?: unknown; modules?: unknown };
  try {
    await createRole(body.name, body.modules ?? []);
  } catch (err) {
    if (sendRoleError(res, err)) return;
    throw err;
  }
  res.status(201).json(await rolesPayload());
});

router.patch("/roles/:key", async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as { name?: unknown; modules?: unknown };
  try {
    await updateRole(req.params.key!, { name: body.name, modules: body.modules });
  } catch (err) {
    if (sendRoleError(res, err)) return;
    throw err;
  }
  res.json(await rolesPayload());
});

router.delete("/roles/:key", async (req, res): Promise<void> => {
  let moved = 0;
  try {
    moved = await deleteRole(req.params.key!);
    bustUserCache();
  } catch (err) {
    if (sendRoleError(res, err)) return;
    throw err;
  }
  res.json({ ...(await rolesPayload()), moved });
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
