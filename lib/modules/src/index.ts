// The parts of the stock book that can be switched on or off.
//
// Two layers decide what someone can use:
//   1. Site modules: which modules this dealer has, set from the central
//      console. The core stock book is always on.
//      Each module has a tier:
//        - "included": every dealer gets it unless switched off for them
//          (so a new included module reaches every dealer on the next release);
//        - "premium": off unless switched on for a dealer.
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
    tier: "included",
  },
  {
    key: "cash_sheet",
    name: "Cash sheet",
    description: "Cash expenses and opening balance.",
    staffDefault: true,
    tier: "included",
  },
  {
    key: "contacts",
    name: "Saved contacts",
    description: "Saved sellers and finance companies.",
    staffDefault: true,
    tier: "included",
  },
  {
    key: "finance_sales",
    name: "Finance sales",
    description: "Selling through a finance company: finance invoices, payment schedules, FRN wording.",
    staffDefault: true,
    tier: "included",
  },
  {
    key: "showroom",
    name: "Showroom website",
    description: "Public stock pages, contact page and enquiry form.",
    staffDefault: true,
    tier: "included",
  },
  {
    key: "leads",
    name: "Leads",
    description: "Enquiries from the showroom website.",
    staffDefault: true,
    tier: "included",
  },
  {
    key: "cazoo_import",
    name: "Cazoo import",
    description: "Import stock and photos from a Cazoo dealer page, with a daily check.",
    staffDefault: true,
    tier: "included",
  },
  {
    key: "csv_import",
    name: "Spreadsheet import",
    description: "Opening stock import from a CSV spreadsheet.",
    staffDefault: true,
    tier: "included",
  },
  {
    key: "reg_lookup",
    name: "Registration lookup",
    description: "Fill in vehicle details from a registration number.",
    staffDefault: true,
    tier: "included",
  },
] as const satisfies readonly {
  key: string;
  name: string;
  description: string;
  staffDefault: boolean;
  tier: ModuleTier;
}[];

export type ModuleTier = "included" | "premium";

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

export const INCLUDED_MODULES: ModuleKey[] = MODULES.filter((m) => tierOf(m) === "included").map((m) => m.key);
export const PREMIUM_MODULES: ModuleKey[] = MODULES.filter((m) => tierOf(m) === "premium").map((m) => m.key);

export function moduleTier(key: ModuleKey): ModuleTier {
  const m = MODULES.find((x) => x.key === key);
  return m ? tierOf(m) : "included";
}

/** A dealer's exceptions to the defaults: premium modules switched on, included ones switched off. */
export interface ModuleOverrides {
  on: ModuleKey[];
  off: ModuleKey[];
}

/** The modules a dealer has: every included module except those switched off, plus premium ones switched on. */
export function resolveModules(overrides: { on?: unknown; off?: unknown } | null | undefined): ModuleKey[] {
  const on = new Set(cleanModuleList(overrides?.on));
  const off = new Set(cleanModuleList(overrides?.off));
  return MODULE_KEYS.filter((k) => (moduleTier(k) === "included" ? !off.has(k) : on.has(k)));
}

/** The exceptions that produce exactly this list of modules today. */
export function overridesFromList(list: unknown): ModuleOverrides {
  const chosen = new Set(cleanModuleList(list));
  return {
    on: PREMIUM_MODULES.filter((k) => chosen.has(k)),
    off: INCLUDED_MODULES.filter((k) => !chosen.has(k)),
  };
}

/**
 * Reads a stored module setting: { on, off } (current) or { enabled: [...] }
 * (earlier full-list format, read as the exceptions it implies).
 */
export function readModuleSetting(value: unknown): ModuleOverrides {
  if (value && typeof value === "object") {
    const v = value as { on?: unknown; off?: unknown; enabled?: unknown };
    if (Array.isArray(v.on) || Array.isArray(v.off)) return { on: cleanModuleList(v.on), off: cleanModuleList(v.off) };
    if (Array.isArray(v.enabled)) return overridesFromList(v.enabled);
  }
  return { on: [], off: [] };
}
