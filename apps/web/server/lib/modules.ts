// Which modules this site has, and which the Staff role may use.
// Stored in system_state (this site's own database):
//   "site_modules" -> { enabled: ModuleKey[] }   set by Broadland Digital
//   "role_modules" -> { staff: ModuleKey[] }     set by the dealer's admin
// Until something is saved, every module is on and Staff get the defaults.
import { db, eq, systemStateTable } from "@workspace/db";
import type { NextFunction, Request, Response } from "../http";
import {
  DEFAULT_STAFF_MODULES,
  MODULE_KEYS,
  cleanModuleList,
  type ModuleKey,
} from "../../src/lib/modules";
import { getSessionUserId, getUserEmail, isEmailAdmin } from "../middlewares/requireAuth";

const SITE_KEY = "site_modules";
const ROLE_KEY = "role_modules";
const CACHE_MS = 30_000;

let cache: { site: ModuleKey[]; staff: ModuleKey[]; ts: number } | null = null;

async function readState(key: string): Promise<unknown> {
  const [row] = await db
    .select({ value: systemStateTable.value })
    .from(systemStateTable)
    .where(eq(systemStateTable.key, key));
  return row?.value ?? null;
}

async function writeState(key: string, value: unknown): Promise<void> {
  await db
    .insert(systemStateTable)
    .values({ key, value })
    .onConflictDoUpdate({ target: systemStateTable.key, set: { value, updatedAt: new Date() } });
  cache = null;
}

async function load(): Promise<{ site: ModuleKey[]; staff: ModuleKey[] }> {
  const now = Date.now();
  if (cache && now - cache.ts < CACHE_MS) return cache;
  const [siteRaw, roleRaw] = await Promise.all([readState(SITE_KEY), readState(ROLE_KEY)]);
  const site = siteRaw && typeof siteRaw === "object" && "enabled" in siteRaw
    ? cleanModuleList((siteRaw as { enabled: unknown }).enabled)
    : [...MODULE_KEYS];
  const staff = roleRaw && typeof roleRaw === "object" && "staff" in roleRaw
    ? cleanModuleList((roleRaw as { staff: unknown }).staff)
    : [...DEFAULT_STAFF_MODULES];
  cache = { site, staff, ts: now };
  return cache;
}

/** Modules this dealer has. */
export async function getSiteModules(): Promise<ModuleKey[]> {
  return (await load()).site;
}

/** Modules the Staff role may use (only ones the site has). */
export async function getStaffModules(): Promise<ModuleKey[]> {
  const { site, staff } = await load();
  return staff.filter((k) => site.includes(k));
}

/** Modules a user may use: admins get every site module. */
export async function modulesFor(isAdmin: boolean): Promise<ModuleKey[]> {
  return isAdmin ? getSiteModules() : getStaffModules();
}

export async function setSiteModules(enabled: unknown): Promise<ModuleKey[]> {
  const list = cleanModuleList(enabled);
  await writeState(SITE_KEY, { enabled: list });
  return list;
}

export async function setStaffModules(staff: unknown): Promise<ModuleKey[]> {
  const list = cleanModuleList(staff);
  await writeState(ROLE_KEY, { staff: list });
  return list;
}

/** Clears the cache (tests, or after another instance changed settings). */
export function bustModuleCache(): void {
  cache = null;
}

async function userModules(req: Request): Promise<ModuleKey[]> {
  const sessionUserId = getSessionUserId(req);
  const email = sessionUserId ? await getUserEmail(sessionUserId) : null;
  return modulesFor(await isEmailAdmin(email));
}

/**
 * Route guard: the signed-in user must be able to use at least one of the
 * given modules. Use after requireAuth.
 */
export function requireModule(...keys: ModuleKey[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const allowed = await userModules(req);
    if (keys.some((k) => allowed.includes(k))) {
      next();
      return;
    }
    const site = await getSiteModules();
    const onSite = keys.some((k) => site.includes(k));
    res.status(403).json({
      error: onSite ? "module_not_allowed" : "module_disabled",
      module: keys[0],
      message: onSite
        ? "Your role doesn't include this part of the stock book. Ask an admin."
        : "This part of the stock book isn't switched on for your account.",
    });
  };
}

/** Public-page guard: the site must have the module (no sign-in involved). */
export function requireSiteModule(key: ModuleKey) {
  return async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    if ((await getSiteModules()).includes(key)) {
      next();
      return;
    }
    res.status(404).json({ error: "Not found" });
  };
}
