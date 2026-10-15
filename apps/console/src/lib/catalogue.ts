// The Modules page: each module's tier (core / premium) and whether it's on for
// everyone. Changes are sent to every live dealer's site straight away.
import { eq } from "drizzle-orm";
import {
  MODULES,
  cleanCatalogue,
  isModuleKey,
  moduleAvailable,
  moduleTier,
  type ModuleCatalogue,
  type ModuleKey,
  type ModuleTier,
} from "@workspace/modules";
import { auditLogTable, dealersTable, getDb, moduleSettingsTable } from "@/db/client";
import { dealerModules, listDealers, moduleColumns } from "@/lib/dealers";
import { pushModules } from "@/lib/setup";

export async function getCatalogue(): Promise<ModuleCatalogue> {
  const rows = await getDb().select().from(moduleSettingsTable);
  return cleanCatalogue(Object.fromEntries(rows.map((r) => [r.key, { tier: r.tier, enabled: r.enabled }])));
}

export interface ModuleRow {
  key: ModuleKey;
  name: string;
  description: string;
  tier: ModuleTier;
  enabled: boolean;
  /** Live dealers that have it. */
  dealers: number;
}

export async function listModuleRows(): Promise<{ rows: ModuleRow[]; liveDealers: number }> {
  const [catalogue, dealers] = await Promise.all([getCatalogue(), listDealers()]);
  const live = dealers.filter((d) => d.status === "active");
  const has = live.map((d) => dealerModules(d, catalogue));
  return {
    liveDealers: live.length,
    rows: MODULES.map((m) => ({
      key: m.key,
      name: m.name,
      description: m.description,
      tier: moduleTier(m.key, catalogue),
      enabled: moduleAvailable(m.key, catalogue),
      dealers: has.filter((list) => list.includes(m.key)).length,
    })),
  };
}

/** Sends every live dealer its modules. Returns the names of dealers whose site couldn't be reached. */
async function pushAll(catalogue: ModuleCatalogue): Promise<string[]> {
  const live = (await listDealers()).filter((d) => d.status === "active");
  const failed: string[] = [];
  await Promise.all(
    live.map(async (d) => {
      if (await pushModules(d, catalogue)) failed.push(d.name);
    }),
  );
  return failed;
}

/**
 * Changes a module's tier. Dealers keep exactly what they have today (a dealer
 * with the module keeps it; one without stays without); only dealers set up
 * from now on get the new default.
 */
export async function setModuleTier(keyRaw: unknown, tierRaw: unknown, actor: string): Promise<string[]> {
  if (!isModuleKey(keyRaw)) throw new Error("Unknown module.");
  if (tierRaw !== "core" && tierRaw !== "premium") throw new Error("Choose core or premium.");
  const key = keyRaw;
  const db = getDb();
  const before = await getCatalogue();
  const dealers = await listDealers();
  const current = new Map(dealers.map((d) => [d.id, dealerModules(d, before)]));
  const after: ModuleCatalogue = { ...before, [key]: { ...before[key], tier: tierRaw } };

  await db
    .insert(moduleSettingsTable)
    .values({ key, tier: tierRaw, enabled: moduleAvailable(key, before), updatedBy: actor })
    .onConflictDoUpdate({ target: moduleSettingsTable.key, set: { tier: tierRaw, updatedBy: actor, updatedAt: new Date() } });
  for (const d of dealers) {
    await db.update(dealersTable).set(moduleColumns(current.get(d.id) ?? [], after)).where(eq(dealersTable.id, d.id));
  }
  await db.insert(auditLogTable).values({ actorEmail: actor, action: "module.tier", detail: { module: key, tier: tierRaw } });
  return pushAll(after);
}

/** Switches a module on or off for every dealer (dealers' own choices are kept for when it's back on). */
export async function setModuleEnabled(keyRaw: unknown, enabled: boolean, actor: string): Promise<string[]> {
  if (!isModuleKey(keyRaw)) throw new Error("Unknown module.");
  const key = keyRaw;
  const db = getDb();
  const before = await getCatalogue();
  await db
    .insert(moduleSettingsTable)
    .values({ key, tier: moduleTier(key, before), enabled, updatedBy: actor })
    .onConflictDoUpdate({ target: moduleSettingsTable.key, set: { enabled, updatedBy: actor, updatedAt: new Date() } });
  await db.insert(auditLogTable).values({ actorEmail: actor, action: "module.enabled", detail: { module: key, enabled } });
  return pushAll({ ...before, [key]: { ...before[key], enabled } });
}
