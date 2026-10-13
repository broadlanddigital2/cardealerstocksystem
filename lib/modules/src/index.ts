// The parts of the stock book that can be switched on or off.
//
// Two layers decide what someone can use:
//   1. Site modules: which modules this dealer has (set by Broadland Digital,
//      later from the central console). The core stock book is always on.
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
  },
  {
    key: "cash_sheet",
    name: "Cash sheet",
    description: "Cash expenses and opening balance.",
    staffDefault: true,
  },
  {
    key: "contacts",
    name: "Saved contacts",
    description: "Saved sellers and finance companies.",
    staffDefault: true,
  },
  {
    key: "finance_sales",
    name: "Finance sales",
    description: "Selling through a finance company: finance invoices, payment schedules, FRN wording.",
    staffDefault: true,
  },
  {
    key: "showroom",
    name: "Showroom website",
    description: "Public stock pages, contact page and enquiry form.",
    staffDefault: true,
  },
  {
    key: "leads",
    name: "Leads",
    description: "Enquiries from the showroom website.",
    staffDefault: true,
  },
  {
    key: "cazoo_import",
    name: "Cazoo import",
    description: "Import stock and photos from a Cazoo dealer page, with a daily check.",
    staffDefault: true,
  },
  {
    key: "csv_import",
    name: "Spreadsheet import",
    description: "Opening stock import from a CSV spreadsheet.",
    staffDefault: true,
  },
  {
    key: "reg_lookup",
    name: "Registration lookup",
    description: "Fill in vehicle details from a registration number.",
    staffDefault: true,
  },
] as const;

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
