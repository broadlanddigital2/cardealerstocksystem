// Which modules this site has, and which modules each role may use.
//
//  - Site modules: system_state "site_modules" -> { enabled: ModuleKey[] }.
//    Set by Broadland Digital (later the console). Default: every module.
//  - Roles: the `roles` table. "admin" is built in (every site module, plus
//    Settings and Users). The role with key "user" is the default Staff role;
//    it is created on first use and can be renamed but not deleted.
//    app_users.role holds "admin" or a role key; unknown keys act as Staff.
import { db, eq, appUsersTable, rolesTable, systemStateTable } from "@workspace/db";
import type { NextFunction, Request, Response } from "../http";
import {
  DEFAULT_STAFF_MODULES,
  MODULE_KEYS,
  cleanModuleList,
  type ModuleKey,
} from "../../src/lib/modules";
import { getEmailRole, getSessionUserId, getUserEmail } from "../middlewares/requireAuth";

export const ADMIN_ROLE = "admin";
export const DEFAULT_ROLE = "user";
const SITE_KEY = "site_modules";
/** Earlier single Staff setting, used once to seed the default role. */
const LEGACY_ROLE_KEY = "role_modules";
const CACHE_MS = 30_000;

export interface RoleInfo {
  key: string;
  name: string;
  /** Modules this role may use (already limited to the site's modules). */
  modules: ModuleKey[];
  isDefault: boolean;
}

let cache: { site: ModuleKey[]; roles: RoleInfo[]; ts: number } | null = null;

async function readState(key: string): Promise<unknown> {
  const [row] = await db
    .select({ value: systemStateTable.value })
    .from(systemStateTable)
    .where(eq(systemStateTable.key, key));
  return row?.value ?? null;
}

async function ensureDefaultRole(): Promise<void> {
  const [existing] = await db.select({ id: rolesTable.id }).from(rolesTable).where(eq(rolesTable.key, DEFAULT_ROLE));
  if (existing) return;
  const legacy = await readState(LEGACY_ROLE_KEY);
  const modules =
    legacy && typeof legacy === "object" && "staff" in legacy
      ? cleanModuleList((legacy as { staff: unknown }).staff)
      : [...DEFAULT_STAFF_MODULES];
  await db
    .insert(rolesTable)
    .values({ key: DEFAULT_ROLE, name: "Staff", modules })
    .onConflictDoNothing({ target: rolesTable.key });
}

async function load(): Promise<{ site: ModuleKey[]; roles: RoleInfo[] }> {
  const now = Date.now();
  if (cache && now - cache.ts < CACHE_MS) return cache;
  await ensureDefaultRole();
  const [siteRaw, rows] = await Promise.all([
    readState(SITE_KEY),
    db.select().from(rolesTable).orderBy(rolesTable.id),
  ]);
  const site =
    siteRaw && typeof siteRaw === "object" && "enabled" in siteRaw
      ? cleanModuleList((siteRaw as { enabled: unknown }).enabled)
      : [...MODULE_KEYS];
  const roles: RoleInfo[] = rows.map((r) => ({
    key: r.key,
    name: r.name,
    modules: cleanModuleList(r.modules).filter((k) => site.includes(k)),
    isDefault: r.key === DEFAULT_ROLE,
  }));
  // Default role first, then in order of creation.
  roles.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  cache = { site, roles, ts: now };
  return cache;
}

export function bustModuleCache(): void {
  cache = null;
}

/** Modules this dealer has. */
export async function getSiteModules(): Promise<ModuleKey[]> {
  return (await load()).site;
}

export async function listRoles(): Promise<RoleInfo[]> {
  return (await load()).roles;
}

export async function roleExists(key: string): Promise<boolean> {
  return key === ADMIN_ROLE || (await listRoles()).some((r) => r.key === key);
}

/** Modules a role may use. Admin gets every site module; unknown roles act as Staff. */
export async function modulesForRole(roleKey: string): Promise<ModuleKey[]> {
  const { site, roles } = await load();
  if (roleKey === ADMIN_ROLE) return site;
  const role = roles.find((r) => r.key === roleKey) ?? roles.find((r) => r.isDefault);
  return role?.modules ?? [];
}

export async function setSiteModules(enabled: unknown): Promise<ModuleKey[]> {
  const list = cleanModuleList(enabled);
  await db
    .insert(systemStateTable)
    .values({ key: SITE_KEY, value: { enabled: list } })
    .onConflictDoUpdate({
      target: systemStateTable.key,
      set: { value: { enabled: list }, updatedAt: new Date() },
    });
  bustModuleCache();
  return list;
}

export class RoleError extends Error {}

function cleanName(name: unknown): string {
  const n = typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
  if (!n || n.length > 40) throw new RoleError("Give the role a name of up to 40 characters.");
  if (n.toLowerCase() === "admin") throw new RoleError("\"Admin\" is a built-in role. Choose another name.");
  return n;
}

async function assertNameFree(name: string, exceptKey?: string): Promise<void> {
  const clash = (await listRoles()).find(
    (r) => r.name.toLowerCase() === name.toLowerCase() && r.key !== exceptKey,
  );
  if (clash) throw new RoleError(`There's already a role called "${clash.name}".`);
}

export async function createRole(name: unknown, modules: unknown): Promise<RoleInfo> {
  const n = cleanName(name);
  await assertNameFree(n);
  const key = `r_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
  await db.insert(rolesTable).values({ key, name: n, modules: cleanModuleList(modules) });
  bustModuleCache();
  return (await listRoles()).find((r) => r.key === key)!;
}

export async function updateRole(
  key: string,
  changes: { name?: unknown; modules?: unknown },
): Promise<RoleInfo> {
  if (!(await listRoles()).some((r) => r.key === key)) throw new RoleError("That role no longer exists.");
  const set: { name?: string; modules?: string[] } = {};
  if (changes.name !== undefined) {
    set.name = cleanName(changes.name);
    await assertNameFree(set.name, key);
  }
  if (changes.modules !== undefined) set.modules = cleanModuleList(changes.modules);
  if (Object.keys(set).length) {
    await db.update(rolesTable).set(set).where(eq(rolesTable.key, key));
    bustModuleCache();
  }
  return (await listRoles()).find((r) => r.key === key)!;
}

/** Deletes a role; its people move to the default Staff role. Returns how many moved. */
export async function deleteRole(key: string): Promise<number> {
  if (key === DEFAULT_ROLE) throw new RoleError("The default Staff role can be renamed but not deleted.");
  if (!(await listRoles()).some((r) => r.key === key)) throw new RoleError("That role no longer exists.");
  const moved = await db
    .update(appUsersTable)
    .set({ role: DEFAULT_ROLE })
    .where(eq(appUsersTable.role, key))
    .returning({ id: appUsersTable.id });
  await db.delete(rolesTable).where(eq(rolesTable.key, key));
  bustModuleCache();
  return moved.length;
}

async function userModules(req: Request): Promise<ModuleKey[]> {
  const sessionUserId = getSessionUserId(req);
  const email = sessionUserId ? await getUserEmail(sessionUserId) : null;
  return modulesForRole(await getEmailRole(email));
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
