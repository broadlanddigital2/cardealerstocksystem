// Starting a dealer's setup ("provisioning"). The work itself runs as the
// GitHub workflow "Set up dealer" (provision-dealer.yml), which builds and
// deploys the dealer's site and reports each step back to this database.
import { and, asc, desc, eq } from "drizzle-orm";
import { auditLogTable, dealersTable, getDb, setupStepsTable, type Dealer } from "@/db/client";
import { dealerOverrides } from "@/lib/dealers";

export const SETUP_STEPS = [
  { key: "database", label: "Create the dealer's database (Neon, London)" },
  { key: "tables", label: "Set up the database tables" },
  { key: "files", label: "Create the file bucket (EU)" },
  { key: "site", label: "Deploy the dealer's site" },
  { key: "secrets", label: "Set the site's secrets" },
  { key: "settings", label: "Save business details, modules and first admin" },
  { key: "check", label: "Check the site is up" },
  { key: "invite", label: "Email the first admin" },
] as const;

const PLATFORM_DOMAIN = () => process.env.PLATFORM_DOMAIN || "racecargraphics.uk";

/** The address staff use: their own staff domain, or <slug>-stockbook.<platform domain>. */
export function siteHost(d: Pick<Dealer, "slug" | "staffDomain">): string {
  return d.staffDomain || `${d.slug}-stockbook.${PLATFORM_DOMAIN()}`;
}

function randomSecret(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function latestSteps(dealerId: number) {
  const db = getDb();
  const [last] = await db
    .select({ runId: setupStepsTable.runId })
    .from(setupStepsTable)
    .where(eq(setupStepsTable.dealerId, dealerId))
    .orderBy(desc(setupStepsTable.id))
    .limit(1);
  if (!last) return [];
  return db
    .select()
    .from(setupStepsTable)
    .where(and(eq(setupStepsTable.dealerId, dealerId), eq(setupStepsTable.runId, last.runId)))
    .orderBy(asc(setupStepsTable.position));
}

/** Records the run, then asks GitHub to start the setup workflow. */
export async function startSetup(dealer: Dealer, actor: string): Promise<void> {
  const token = process.env.CONSOLE_GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO || "broadlanddigital2/cardealerstocksystem";
  const ref = process.env.PROVISION_REF || "main";
  const target = process.env.CONSOLE_TARGET || "live";
  if (!token) throw new Error("The console can't start setups yet (CONSOLE_GITHUB_TOKEN isn't set).");

  const db = getDb();
  const runId = `${Date.now()}`;
  await db.insert(setupStepsTable).values(
    SETUP_STEPS.map((s, i) => ({ dealerId: dealer.id, runId, position: i, step: s.key, status: "pending" })),
  );
  await db
    .update(dealersTable)
    .set({ status: "provisioning", platformSecret: dealer.platformSecret ?? randomSecret() })
    .where(eq(dealersTable.id, dealer.id));
  await db.insert(auditLogTable).values({
    actorEmail: actor,
    dealerId: dealer.id,
    action: "dealer.setup_started",
    detail: { runId, ref },
  });

  const resp = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/provision-dealer.yml/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "stockbook-console",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ ref, inputs: { dealer_id: String(dealer.id), run_id: runId, console: target } }),
  });
  if (!resp.ok) {
    const detail = (await resp.text()).slice(0, 300);
    await db.update(dealersTable).set({ status: "failed" }).where(eq(dealersTable.id, dealer.id));
    await db
      .update(setupStepsTable)
      .set({ status: "failed", message: `Couldn't start the setup job (GitHub ${resp.status}): ${detail}` })
      .where(and(eq(setupStepsTable.dealerId, dealer.id), eq(setupStepsTable.runId, runId), eq(setupStepsTable.position, 0)));
    throw new Error(`Couldn't start the setup job (GitHub ${resp.status}).`);
  }
}

/** Sends a dealer's modules to their live site. Returns an error message or null. */
export async function pushModules(dealer: Dealer): Promise<string | null> {
  if (dealer.status !== "active" || !dealer.siteUrl || !dealer.platformSecret) return null;
  try {
    const resp = await fetch(`${dealer.siteUrl}/api/platform/modules`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${dealer.platformSecret}`, "Content-Type": "application/json" },
      body: JSON.stringify(dealerOverrides(dealer)),
      signal: AbortSignal.timeout(15_000),
    });
    return resp.ok ? null : `The dealer's site answered ${resp.status}.`;
  } catch (err) {
    return err instanceof Error ? err.message : "Couldn't reach the dealer's site.";
  }
}
