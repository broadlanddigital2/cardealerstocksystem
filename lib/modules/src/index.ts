// The parts of the stock book that can be switched on or off.
//
// Two layers decide what someone can use:
//   1. Site modules: which modules this dealer has, set from the central
//      console. The core stock book is always on.
//      Each module has a tier:
//        - "core": every dealer gets it unless switched off for them
//          (so a new core module reaches every dealer on the next release);
//        - "premium": off unless switched on for a dealer.
//      and can be switched off for everyone. The tier and the on/off-for-
//      everyone switch are set on the console's Modules page; the values in
//      this file are only the defaults for a brand-new module.
//      A dealer stores only its exceptions ({ on, off }), never a full list.
//   2. Role modules: which of those the "Staff" role may use (set by the
//      dealer's admin in Settings -> Roles). Admins get every site module,
//      plus Settings and Users.
// Shared by the server (enforcement) and the browser (menus and pages).

export const MODULES = [
  {
    key: "reports",
    name: "Reports & exports",
    description: "Stock, purchases, sales and deposits reports; CSV, Excel and PDF exports; Xero exports.",
    staffDefault: false,
    tier: "core",
  },
  {
    key: "cash_sheet",
    name: "Cash sheet",
    description: "Cash expenses and opening balance.",
    staffDefault: true,
    tier: "core",
  },
  {
    key: "contacts",
    name: "Saved contacts",
    description: "Saved sellers and finance companies.",
    staffDefault: true,
    tier: "core",
  },
  {
    key: "finance_sales",
    name: "Finance sales",
    description: "Selling through a finance company: finance invoices, payment schedules, FRN wording.",
    staffDefault: true,
    tier: "core",
  },
  {
    key: "showroom",
    name: "Showroom website",
    description: "Public stock pages, contact page and enquiry form.",
    staffDefault: true,
    tier: "core",
  },
  {
    key: "leads",
    name: "Leads",
    description: "Enquiries from the showroom website.",
    staffDefault: true,
    tier: "core",
  },
  {
    key: "cazoo_import",
    name: "Cazoo import",
    description: "Import stock and photos from a Cazoo dealer page, with a daily check.",
    staffDefault: true,
    tier: "core",
  },
  {
    key: "csv_import",
    name: "Spreadsheet import",
    description: "Opening stock import from a CSV spreadsheet.",
    staffDefault: true,
    tier: "core",
  },
  {
    key: "reg_lookup",
    name: "Registration lookup",
    description: "Fill in vehicle details from a registration number.",
    staffDefault: true,
    tier: "core",
  },
] as const satisfies readonly {
  key: string;
  name: string;
  description: string;
  staffDefault: boolean;
  tier: ModuleTier;
}[];

export type ModuleTier = "core" | "premium";

export type ModuleKey = (typeof MODULES)[number]["key"];

export const MODULE_KEYS: readonly ModuleKey[] = MODULES.map((m) => m.key);

export function isModuleKey(value: unknown): value is ModuleKey {
  return typeof value === "string" && (MODULE_KEYS as readonly string[]).includes(value);
}

/** Keeps only known module keys, de-duplicated, in catalogue order. */
export function cleanModuleList(values: unknown): ModuleKey[] {
  const set = new Set(Array.isArray(values) ? values.filter(isModuleKey) : []);
  return MODULE_KEYS.filter((k) => set.has(k));
}

export const DEFAULT_STAFF_MODULES: ModuleKey[] = MODULES.filter((m) => m.staffDefault).map((m) => m.key);

// (Widened to ModuleTier so the checks still compile while every module is in one tier.)
const tierOf = (m: { tier: ModuleTier }): ModuleTier => m.tier;

/** Built-in default tier of a module (before any console setting). */
export function defaultTier(key: ModuleKey): ModuleTier {
  const m = MODULES.find((x) => x.key === key);
  return m ? tierOf(m) : "core";
}

/** Platform-wide settings from the console, per module: its tier and whether it's on for everyone. */
export type ModuleCatalogue = Partial<Record<ModuleKey, { tier?: ModuleTier; enabled?: boolean }>>;

export function moduleTier(key: ModuleKey, catalogue?: ModuleCatalogue | null): ModuleTier {
  const t = catalogue?.[key]?.tier;
  return t === "core" || t === "premium" ? t : defaultTier(key);
}

export function moduleAvailable(key: ModuleKey, catalogue?: ModuleCatalogue | null): boolean {
  return catalogue?.[key]?.enabled !== false;
}

/** Keeps only valid entries of a catalogue setting. */
export function cleanCatalogue(value: unknown): ModuleCatalogue {
  const out: ModuleCatalogue = {};
  if (!value || typeof value !== "object") return out;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!isModuleKey(k) || !v || typeof v !== "object") continue;
    const { tier, enabled } = v as { tier?: unknown; enabled?: unknown };
    out[k] = {
      ...(tier === "core" || tier === "premium" ? { tier } : {}),
      ...(typeof enabled === "boolean" ? { enabled } : {}),
    };
  }
  return out;
}

/** A dealer's exceptions to the defaults: premium modules switched on, core ones switched off. */
export interface ModuleOverrides {
  on: ModuleKey[];
  off: ModuleKey[];
}

/** What a dealer site stores: its exceptions plus the platform-wide settings it was last sent. */
export interface ModuleSetting extends ModuleOverrides {
  catalogue: ModuleCatalogue;
}

/**
 * The modules a dealer has: modules that are on for everyone, and either core
 * (unless switched off for this dealer) or premium and switched on for it.
 */
export function resolveModules(
  setting: { on?: unknown; off?: unknown; catalogue?: ModuleCatalogue | null } | null | undefined,
): ModuleKey[] {
  const on = new Set(cleanModuleList(setting?.on));
  const off = new Set(cleanModuleList(setting?.off));
  const cat = setting?.catalogue;
  return MODULE_KEYS.filter(
    (k) => moduleAvailable(k, cat) && (moduleTier(k, cat) === "core" ? !off.has(k) : on.has(k)),
  );
}

/** The exceptions that produce exactly this list of modules (with these platform settings). */
export function overridesFromList(list: unknown, catalogue?: ModuleCatalogue | null): ModuleOverrides {
  const chosen = new Set(cleanModuleList(list));
  return {
    on: MODULE_KEYS.filter((k) => moduleTier(k, catalogue) === "premium" && chosen.has(k)),
    off: MODULE_KEYS.filter((k) => moduleTier(k, catalogue) === "core" && !chosen.has(k)),
  };
}

/**
 * Reads a stored module setting: { on, off, catalogue } (current) or
 * { enabled: [...] } (earlier full-list format, read as the exceptions it implies).
 */
export function readModuleSetting(value: unknown): ModuleSetting {
  if (value && typeof value === "object") {
    const v = value as { on?: unknown; off?: unknown; enabled?: unknown; catalogue?: unknown };
    const catalogue = cleanCatalogue(v.catalogue);
    if (Array.isArray(v.on) || Array.isArray(v.off)) {
      return { on: cleanModuleList(v.on), off: cleanModuleList(v.off), catalogue };
    }
    if (Array.isArray(v.enabled)) return { ...overridesFromList(v.enabled, catalogue), catalogue };
  }
  return { on: [], off: [], catalogue: {} };
}
