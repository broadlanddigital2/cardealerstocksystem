import { eq } from "drizzle-orm";
import { db, dealerSettingsTable, systemStateTable } from "@workspace/db";
import { SHARED_TENANT_ID } from "../middlewares/requireAuth";
import { logger } from "./logger";
import { sendCazooHealthAlert } from "./email";
import {
  CazooFetchError,
  evaluateParsedStock,
  fetchCazooHtml,
  parseDealerPage,
} from "./cazoo";

// Periodic "canary" check for the Cazoo import feature. The parser tests run
// against saved HTML fixtures, so a live Cazoo redesign would otherwise go
// unnoticed until a dealer's import silently returned empty or partial data.
// This check re-fetches the dealer's real Cazoo page (remembered from their
// last successful preview) once a day, runs the same parser the import uses,
// and shouts — error log + email to the dealer's notification address + a
// warning banner on the Import page — when key fields come back empty.
//
// It is fully decoupled from the import flow: it never blocks a request, all
// failures are caught, and imports keep working (or failing with their own
// friendly errors) regardless of what this check is doing.

export type CazooHealthStatus =
  | "ok" // page fetched and parsed with all key fields present
  | "failing" // page fetched but the parser returned empty/partial data
  | "fetch_error" // page could not be fetched (blocked/offline) — inconclusive
  | "not_configured"; // no dealer URL remembered yet — nothing to check

export interface CazooHealthResult {
  status: CazooHealthStatus;
  checkedAt: string; // ISO timestamp of when the check ran
  url: string | null;
  vehicleCount: number;
  problems: Array<string>;
  message: string;
}

// State is persisted in the system_state table (serverless instances share no
// memory): the last result, and the signature of the last failure we emailed
// about so a persistent failure doesn't re-email the admin every single day.
const STATE_KEY = "cazoo_health";
interface PersistedState {
  lastResult: CazooHealthResult | null;
  lastAlertSignature: string | null;
}

let running: Promise<CazooHealthResult> | null = null;

async function loadState(): Promise<PersistedState> {
  try {
    const [row] = await db
      .select({ value: systemStateTable.value })
      .from(systemStateTable)
      .where(eq(systemStateTable.key, STATE_KEY));
    const v = (row?.value ?? null) as PersistedState | null;
    return { lastResult: v?.lastResult ?? null, lastAlertSignature: v?.lastAlertSignature ?? null };
  } catch {
    return { lastResult: null, lastAlertSignature: null };
  }
}

async function saveState(state: PersistedState): Promise<void> {
  await db
    .insert(systemStateTable)
    .values({ key: STATE_KEY, value: state })
    .onConflictDoUpdate({ target: systemStateTable.key, set: { value: state, updatedAt: new Date() } });
}

/** The most recent health check result, or null if none has run yet. */
export async function getCazooHealth(): Promise<CazooHealthResult | null> {
  return (await loadState()).lastResult;
}

async function getDealerRow(): Promise<
  | { cazooDealerUrl: string | null; email: string | null; businessName: string }
  | undefined
> {
  const [row] = await db
    .select({
      cazooDealerUrl: dealerSettingsTable.cazooDealerUrl,
      email: dealerSettingsTable.email,
      businessName: dealerSettingsTable.businessName,
    })
    .from(dealerSettingsTable)
    .where(eq(dealerSettingsTable.userId, SHARED_TENANT_ID));
  return row;
}

async function alertFailure(
  result: CazooHealthResult,
  dealer: { email: string | null; businessName: string } | undefined,
  state: PersistedState,
): Promise<void> {
  logger.error(
    { url: result.url, problems: result.problems },
    "CAZOO HEALTH CHECK FAILED — Cazoo may have changed their website; imports are likely broken until the parser is updated",
  );
  const signature = result.problems.join("|");
  if (signature === state.lastAlertSignature) return; // already emailed this failure
  const to = dealer?.email?.trim();
  if (!to) {
    logger.warn(
      "No dealer notification email set in Settings — Cazoo health alert not emailed.",
    );
    state.lastAlertSignature = signature;
    return;
  }
  await sendCazooHealthAlert({
    to,
    businessName: dealer?.businessName ?? "",
    url: result.url ?? "",
    problems: result.problems,
  });
  state.lastAlertSignature = signature;
}

/**
 * Runs one health check now: fetches the remembered Cazoo dealer page (first
 * page only — enough to validate the markup), parses it with the same parser
 * imports use, and records/alerts on the outcome. Never throws.
 */
export async function runCazooHealthCheck(): Promise<CazooHealthResult> {
  // Coalesce concurrent callers (scheduler + on-demand button) into one run.
  if (running) return running;
  running = doRun().finally(() => {
    running = null;
  });
  return running;
}

async function doRun(): Promise<CazooHealthResult> {
  const state = await loadState();
  const checkedAt = new Date().toISOString();
  let result: CazooHealthResult;
  let dealer: Awaited<ReturnType<typeof getDealerRow>>;
  try {
    dealer = await getDealerRow();
    const url = dealer?.cazooDealerUrl?.trim() || null;
    if (!url) {
      result = {
        status: "not_configured",
        checkedAt,
        url: null,
        vehicleCount: 0,
        problems: [],
        message:
          "No Cazoo dealer page is on record yet. Run a Cazoo preview once and the daily check will start automatically.",
      };
    } else {
      try {
        const html = await fetchCazooHtml(url);
        const rows = parseDealerPage(html);
        const problems = evaluateParsedStock(rows);
        if (problems.length > 0) {
          result = {
            status: "failing",
            checkedAt,
            url,
            vehicleCount: rows.length,
            problems,
            message:
              "Cazoo appears to have changed their website — imports may return empty or incomplete cars until this is fixed.",
          };
        } else {
          result = {
            status: "ok",
            checkedAt,
            url,
            vehicleCount: rows.length,
            problems: [],
            message: `Cazoo import is healthy — ${rows.length} vehicle${rows.length === 1 ? "" : "s"} read correctly from your dealer page.`,
          };
          state.lastAlertSignature = null; // recovered — alert again on next failure
        }
      } catch (err) {
        const detail =
          err instanceof CazooFetchError
            ? err.friendly
            : "The Cazoo page couldn't be fetched.";
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), url },
          "Cazoo health check could not fetch the dealer page (inconclusive)",
        );
        result = {
          status: "fetch_error",
          checkedAt,
          url,
          vehicleCount: 0,
          problems: [],
          message: `The daily Cazoo check couldn't read your dealer page this time. ${detail}`,
        };
      }
    }
  } catch (err) {
    // Absolute backstop: even a DB error must never crash the scheduler.
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "Cazoo health check failed unexpectedly",
    );
    result = {
      status: "fetch_error",
      checkedAt,
      url: null,
      vehicleCount: 0,
      problems: [],
      message: "The Cazoo health check hit an unexpected error. See server logs.",
    };
  }

  state.lastResult = result;
  logger.info(
    { status: result.status, url: result.url, vehicleCount: result.vehicleCount },
    "Cazoo health check completed",
  );
  if (result.status === "failing") {
    await alertFailure(result, dealer, state).catch((err: unknown) => {
      logger.error({ err }, "Failed to send Cazoo health alert email");
    });
  }
  await saveState(state).catch((err: unknown) => {
    logger.error({ err }, "Failed to persist Cazoo health state");
  });
  return result;
}

// Scheduling: runs daily from the Cloudflare cron trigger (see worker.ts /
// app/api/cron/[job]/route.ts) instead of in-process timers.
