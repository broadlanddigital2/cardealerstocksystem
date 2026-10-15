// Releases: the same version of the stock book going out to every dealer's own
// site. The work runs as the GitHub workflow "Release to dealers"
// (rollout.yml), which records progress in rollouts / rollout_dealers.
import { desc, eq, inArray } from "drizzle-orm";
import { auditLogTable, getDb, rolloutDealersTable, rolloutsTable, type Dealer, type Rollout } from "@/db/client";

async function dispatch(workflow: string, ref: string, inputs: Record<string, string>): Promise<void> {
  const token = process.env.CONSOLE_GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO || "broadlanddigital2/cardealerstocksystem";
  if (!token) throw new Error("The console can't start GitHub jobs yet (CONSOLE_GITHUB_TOKEN isn't set).");
  const resp = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "stockbook-console",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ ref, inputs }),
  });
  if (!resp.ok) throw new Error(`GitHub wouldn't start the job (${resp.status}): ${(await resp.text()).slice(0, 200)}`);
}

/**
 * Releases the latest version (develop for the dev console, main for live) to
 * every dealer, or to one dealer (redeploying it even if it's already current).
 */
export async function startRelease(actor: string, dealer?: Dealer): Promise<number> {
  const ref = process.env.PROVISION_REF || "main";
  const target = process.env.CONSOLE_TARGET || "live";
  const db = getDb();
  const [row] = await db
    .insert(rolloutsTable)
    .values({
      release: ref,
      title: dealer ? `Update ${dealer.name}` : "Release started from the console",
      startedBy: actor,
    })
    .returning();
  await db.insert(auditLogTable).values({
    actorEmail: actor,
    dealerId: dealer?.id ?? null,
    action: dealer ? "dealer.update_started" : "release.started",
    detail: { rolloutId: row!.id, ref },
  });
  try {
    await dispatch("rollout.yml", ref, {
      target,
      rollout_id: String(row!.id),
      dealer_id: dealer ? String(dealer.id) : "",
      force: dealer ? "true" : "false",
      started_by: actor,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(rolloutsTable).set({ status: "failed", message, finishedAt: new Date() }).where(eq(rolloutsTable.id, row!.id));
    throw err;
  }
  return row!.id;
}

export interface RolloutWithDealers extends Rollout {
  dealers: { dealerId: number; wave: number; status: string; message: string | null }[];
}

export async function listReleases(limit = 20): Promise<RolloutWithDealers[]> {
  const db = getDb();
  const rows = await db.select().from(rolloutsTable).orderBy(desc(rolloutsTable.id)).limit(limit);
  if (!rows.length) return [];
  const parts = await db
    .select()
    .from(rolloutDealersTable)
    .where(inArray(rolloutDealersTable.rolloutId, rows.map((r) => r.id)))
    .orderBy(rolloutDealersTable.wave, rolloutDealersTable.id);
  return rows.map((r) => ({
    ...r,
    dealers: parts
      .filter((p) => p.rolloutId === r.id)
      .map((p) => ({ dealerId: p.dealerId, wave: p.wave, status: p.status, message: p.message })),
  }));
}

/** Short form of a release id (a git commit) for display. */
export function shortRelease(release: string | null | undefined): string {
  if (!release) return "—";
  return /^[0-9a-f]{40}$/.test(release) ? release.slice(0, 7) : release;
}

export function releaseCommitUrl(release: string): string | null {
  const repo = process.env.GITHUB_REPO || "broadlanddigital2/cardealerstocksystem";
  return /^[0-9a-f]{40}$/.test(release) ? `https://github.com/${repo}/commit/${release}` : null;
}
