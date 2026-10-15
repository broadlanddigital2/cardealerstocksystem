// Dealer records: validation and saving, with every change written to the audit log.
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import {
  INCLUDED_MODULES,
  cleanModuleList,
  overridesFromList,
  readModuleSetting,
  resolveModules,
  type ModuleOverrides,
} from "@workspace/modules";
import { auditLogTable, dealersTable, getDb, type Dealer } from "@/db/client";

/** Short id: lower-case letters, digits and hyphens, 3–32 characters, starting with a letter. */
export const SLUG_RE = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;

const optional = z
  .string()
  .trim()
  .max(200)
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();
const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v) => (v === "" ? null : v))
  .refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Enter a valid email address.")
  .nullable()
  .optional();
const optionalDomain = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v) => (v === "" ? null : v.replace(/^https?:\/\//, "").replace(/\/.*$/, "")))
  .refine((v) => v === null || /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v), "Enter a domain like example.co.uk.")
  .nullable()
  .optional();

export const dealerInput = z.object({
  name: z.string().trim().min(1, "Enter the business name.").max(200),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(SLUG_RE, "Short id: 3–32 lower-case letters, numbers or hyphens, starting with a letter."),
  companyNumber: optional,
  contactName: optional,
  contactEmail: optionalEmail,
  contactPhone: optional,
  billingEmail: optionalEmail,
  webDomain: optionalDomain,
  staffDomain: optionalDomain,
  showroomDomain: optionalDomain,
  firstAdminEmail: z.string().trim().toLowerCase().email("Enter the first admin's email."),
  modules: z.array(z.string()).transform((m) => cleanModuleList(m)),
  pilot: z.boolean().default(false),
  notes: z.string().trim().max(2000).transform((v) => (v === "" ? null : v)).nullable().optional(),
});

export type DealerInput = z.infer<typeof dealerInput>;

/** Reads the dealer form (module checkboxes are named "module"). */
export function readDealerForm(form: FormData) {
  const get = (k: string) => (form.get(k) as string | null) ?? "";
  return dealerInput.safeParse({
    name: get("name"),
    slug: get("slug"),
    companyNumber: get("companyNumber"),
    contactName: get("contactName"),
    contactEmail: get("contactEmail"),
    contactPhone: get("contactPhone"),
    billingEmail: get("billingEmail"),
    webDomain: get("webDomain"),
    staffDomain: get("staffDomain"),
    showroomDomain: get("showroomDomain"),
    firstAdminEmail: get("firstAdminEmail"),
    modules: form.getAll("module").map(String),
    pilot: form.get("pilot") === "on",
    notes: get("notes"),
  });
}

/** A dealer's module exceptions (records from before tiers are read from their module list). */
export function dealerOverrides(dealer: Pick<Dealer, "modules" | "modulesOn" | "modulesOff">): ModuleOverrides {
  if (dealer.modulesOn == null && dealer.modulesOff == null) return readModuleSetting({ enabled: dealer.modules });
  return readModuleSetting({ on: dealer.modulesOn ?? [], off: dealer.modulesOff ?? [] });
}

/** The modules a dealer has with today's catalogue. */
export function dealerModules(dealer: Pick<Dealer, "modules" | "modulesOn" | "modulesOff">) {
  return resolveModules(dealerOverrides(dealer));
}

/** Saves the ticked modules as exceptions, so later included modules reach the dealer automatically. */
function moduleColumns(list: string[]) {
  const o = overridesFromList(list);
  return { modules: resolveModules(o), modulesOn: o.on, modulesOff: o.off };
}

export async function listDealers(): Promise<Dealer[]> {
  return getDb().select().from(dealersTable).orderBy(dealersTable.name);
}

export async function getDealer(id: number): Promise<Dealer | null> {
  const [row] = await getDb().select().from(dealersTable).where(eq(dealersTable.id, id));
  return row ?? null;
}

export async function slugTaken(slug: string, exceptId?: number): Promise<boolean> {
  const [row] = await getDb().select({ id: dealersTable.id }).from(dealersTable).where(eq(dealersTable.slug, slug));
  return Boolean(row && row.id !== exceptId);
}

export async function createDealer(input: DealerInput, actor: string): Promise<Dealer> {
  const db = getDb();
  const [row] = await db
    .insert(dealersTable)
    .values({ ...input, ...moduleColumns(input.modules), status: "draft" })
    .returning();
  await db.insert(auditLogTable).values({ actorEmail: actor, dealerId: row!.id, action: "dealer.created", detail: input });
  return row!;
}

export async function updateDealer(id: number, input: DealerInput, actor: string): Promise<Dealer> {
  const db = getDb();
  const before = await getDealer(id);
  if (!before) throw new Error("Dealer not found");
  // The short id names the dealer's resources, so it is fixed once provisioned.
  const slug = before.status === "draft" ? input.slug : before.slug;
  const [row] = await db
    .update(dealersTable)
    .set({ ...input, ...moduleColumns(input.modules), slug })
    .where(eq(dealersTable.id, id))
    .returning();
  const previous = { ...before, modules: dealerModules(before) } as Record<string, unknown>;
  const changed = Object.fromEntries(
    Object.entries(input).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(previous[k])),
  );
  await db.insert(auditLogTable).values({ actorEmail: actor, dealerId: id, action: "dealer.updated", detail: changed });
  return row!;
}

export async function dealerHistory(id: number) {
  return getDb()
    .select()
    .from(auditLogTable)
    .where(eq(auditLogTable.dealerId, id))
    .orderBy(desc(auditLogTable.at))
    .limit(50);
}

/** Ticked by default for a new dealer: every included module. */
export const DEFAULT_MODULES = [...INCLUDED_MODULES];
