// Removing a dealer (GDPR deletion), in two stages:
//   1. Remove: the site closes at once (Worker secret SITE_SUSPENDED=1), the
//      dealer is marked removed with a deletion date 30 days ahead, and the
//      "Remove dealer" job exports their data for download.
//   2. Delete: on that date (daily job) or with "Delete now", the job deletes
//      the site, web addresses, files, database, email if chosen, and the export,
//      and strips personal details from this record.
// Until stage 2, "Undo removal" reopens the site.
import { and, eq } from "drizzle-orm";
import { auditLogTable, dealersTable, getDb, setupStepsTable, type Dealer } from "@/db/client";
import { cf } from "@/lib/domains";
import { dispatch } from "@/lib/releases";

export const GRACE_DAYS = 30;

export const REMOVAL_STEPS = [
  { key: "export_data", label: "Export the stock book data (spreadsheets)" },
  { key: "export_files", label: "Export photos and documents" },
] as const;

export const DELETE_STEPS = [
  { key: "delete_addresses", label: "Remove their own web addresses" },
  { key: "delete_site", label: "Delete the site" },
  { key: "delete_files", label: "Delete the file bucket" },
  { key: "delete_database", label: "Delete the database" },
  { key: "delete_email", label: "Delete email (if chosen)" },
  { key: "delete_export", label: "Delete the data export" },
  { key: "tidy_record", label: "Remove personal details from the console" },
] as const;

async function setClosed(dealer: Dealer, closed: boolean): Promise<void> {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!account || !dealer.workerName) return; // never set up: no site to close
  const base = `/accounts/${account}/workers/scripts/${dealer.workerName}/secrets`;
  if (closed) {
    await cf("PUT", base, { name: "SITE_SUSPENDED", text: "1", type: "secret_text" });
  } else {
    await cf("DELETE", `${base}/SITE_SUSPENDED`).catch(() => {});
  }
}

async function startJob(dealer: Dealer, mode: "export" | "delete", keys: readonly { key: string }[]): Promise<void> {
  const runId = `${Date.now()}`;
  const db = getDb();
  await db
    .insert(setupStepsTable)
    .values(keys.map((s, i) => ({ dealerId: dealer.id, runId, position: i, step: s.key, status: "pending" })));
  try {
    await dispatch("offboard-dealer.yml", process.env.PROVISION_REF || "main", {
      mode,
      dealer_id: String(dealer.id),
      run_id: runId,
      console: process.env.CONSOLE_TARGET || "live",
    });
  } catch (err) {
    await db
      .update(setupStepsTable)
      .set({ status: "failed", message: err instanceof Error ? err.message : String(err) })
      .where(and(eq(setupStepsTable.dealerId, dealer.id), eq(setupStepsTable.runId, runId), eq(setupStepsTable.position, 0)));
    throw err;
  }
}

/** Typed confirmation: the dealer's short id. */
export function confirmed(dealer: Dealer, typed: unknown): boolean {
  return String(typed ?? "").trim().toLowerCase() === dealer.slug;
}

export async function removeDealer(dealer: Dealer, actor: string, removeEmail: boolean): Promise<void> {
  const db = getDb();
  if (dealer.status === "draft") {
    // Never set up: nothing exists outside the console.
    await db.delete(setupStepsTable).where(eq(setupStepsTable.dealerId, dealer.id));
    await db.update(auditLogTable).set({ detail: null }).where(eq(auditLogTable.dealerId, dealer.id));
    await db
      .update(dealersTable)
      .set({
        status: "deleted",
        removedAt: new Date(),
        contactName: null,
        contactEmail: null,
        contactPhone: null,
        billingEmail: null,
        firstAdminEmail: "removed",
        notes: null,
      })
      .where(eq(dealersTable.id, dealer.id));
    await db.insert(auditLogTable).values({ actorEmail: actor, dealerId: dealer.id, action: "dealer.deleted" });
    return;
  }
  if (dealer.status !== "active" && dealer.status !== "failed") throw new Error("Only a live (or failed) dealer can be removed.");
  await setClosed(dealer, true);
  const deleteAfter = new Date(Date.now() + GRACE_DAYS * 24 * 60 * 60 * 1000);
  await db
    .update(dealersTable)
    .set({ status: "suspended", removalRequestedAt: new Date(), deleteAfter, removeEmail, exportKeys: null, exportReadyAt: null })
    .where(eq(dealersTable.id, dealer.id));
  await db.insert(auditLogTable).values({
    actorEmail: actor,
    dealerId: dealer.id,
    action: "dealer.removed",
    detail: { deleteAfter: deleteAfter.toISOString(), removeEmail },
  });
  await startJob(dealer, "export", REMOVAL_STEPS);
}

export async function restoreDealer(dealer: Dealer, actor: string): Promise<void> {
  if (dealer.status !== "suspended") throw new Error("This dealer isn't removed.");
  await setClosed(dealer, false);
  await getDb()
    .update(dealersTable)
    .set({ status: "active", removalRequestedAt: null, deleteAfter: null, removeEmail: false })
    .where(eq(dealersTable.id, dealer.id));
  await getDb().insert(auditLogTable).values({ actorEmail: actor, dealerId: dealer.id, action: "dealer.restored" });
}

export async function deleteNow(dealer: Dealer, actor: string): Promise<void> {
  if (dealer.status !== "suspended") throw new Error("Remove the dealer first.");
  await getDb().insert(auditLogTable).values({ actorEmail: actor, dealerId: dealer.id, action: "dealer.delete_started" });
  await startJob(dealer, "delete", DELETE_STEPS);
}

/** Download file name for an export key. */
export function exportFileName(key: string): string {
  return key.split("/").pop() ?? key;
}

/** True when the key belongs to this dealer's exports (so the download link can't fetch anyone else's). */
export function exportKeyBelongs(dealer: Pick<Dealer, "exportKeys">, key: string): boolean {
  return Array.isArray(dealer.exportKeys) && dealer.exportKeys.includes(key);
}
