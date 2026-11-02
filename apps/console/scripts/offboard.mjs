// Removing a dealer. Run by the GitHub workflow "Remove dealer" (offboard-dealer.yml).
//
//   MODE=export  after "Remove dealer" in the console (the site is already closed):
//                export the dealer's data (each table as CSV) and files to the
//                EU exports bucket, for the console's download link.
//   MODE=delete  "Delete now", or 30 days after removal: permanently delete the
//                dealer's site, web addresses, file bucket, database, (if chosen)
//                email, and the export; then strip personal details from the
//                console's record of the dealer.
//   MODE=due     the daily run: deletes every dealer whose 30 days are up, and
//                tidies exports left from removals that were undone.
//
// Progress is written to setup_steps so the console shows each step.
// Env: CONSOLE_DATABASE_URL, CONSOLE_TARGET (live|dev), MODE, DEALER_ID, RUN_ID,
//      NEON_API_KEY, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, TREKMAIL_API_TOKEN, PLATFORM_DOMAIN
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { dealerNames, env, neonDatabaseUrl, pgClient, run } from "./lib/dealer-site.mjs";
import {
  cfApi,
  deleteWorker,
  neonDeleteProject,
  r2DeleteBucket,
  r2EnsureBucket,
  r2Get,
  r2List,
  r2Put,
  r2Delete,
  trekmailDeleteDomain,
} from "./lib/cloud.mjs";

export const EXPORTS_BUCKET = "stockbook-exports";
const PART_BYTES = 250 * 1024 * 1024;
const SKIP_TABLES = new Set(["auth_codes", "auth_sessions"]); // sign-in codes and sessions: not the dealer's records

const mode = env("MODE");
const target = env("CONSOLE_TARGET", false) || "live";
const consoleDb = pgClient(env("CONSOLE_DATABASE_URL"));
await consoleDb.connect();
const q = (text, params) => consoleDb.query(text, params);

function makeStepper(dealerId, runId) {
  let current = null;
  return {
    get current() {
      return current;
    },
    async step(key, fn) {
      current = key;
      await q(
        "update setup_steps set status = 'running', message = null, updated_at = now() where dealer_id = $1 and run_id = $2 and step = $3",
        [dealerId, runId, key],
      );
      console.log(`▶ ${key}`);
      const message = (await fn()) ?? null;
      await q(
        "update setup_steps set status = 'done', message = $4, updated_at = now() where dealer_id = $1 and run_id = $2 and step = $3",
        [dealerId, runId, key, message],
      );
      console.log(`✓ ${key}${message ? `: ${message}` : ""}`);
    },
    async fail(err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      await q(
        "update setup_steps set status = 'failed', message = $4, updated_at = now() where dealer_id = $1 and run_id = $2 and step = $3",
        [dealerId, runId, current ?? "export_data", message],
      ).catch(() => {});
      console.log(`::error title=Removal step ${current} failed::${message.replace(/\n/g, " ")}`);
      return message;
    },
  };
}

async function createSteps(dealerId, runId, keys) {
  for (const [i, key] of keys.entries()) {
    await q("insert into setup_steps (dealer_id, run_id, position, step, status) values ($1, $2, $3, $4, 'pending')", [
      dealerId,
      runId,
      i,
      key,
    ]);
  }
}

const csvCell = (v) => {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function zipDir(dir, zipPath) {
  run("zip", ["-q", "-r", zipPath, "."], { cwd: dir });
}

async function getDealer(id) {
  const { rows } = await q("select * from dealers where id = $1", [id]);
  if (!rows[0]) throw new Error(`Dealer ${id} not found`);
  return rows[0];
}

const exportPrefix = (dealer) => `${target}/${dealer.id}-${dealer.slug}/`;

async function exportDealer(dealer, runId) {
  const s = makeStepper(dealer.id, runId);
  const { bucketName } = dealerNames(dealer);
  const work = mkdtempSync(path.join(tmpdir(), "export-"));
  const keys = [];
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `${exportPrefix(dealer)}${runId}/`;
  try {
    await r2EnsureBucket(EXPORTS_BUCKET);

    await s.step("export_data", async () => {
      if (!dealer.neon_project_id) return "No database recorded";
      const db = pgClient(await neonDatabaseUrl(dealer.neon_project_id));
      await db.connect();
      const dataDir = path.join(work, "data");
      mkdirSync(dataDir);
      let tables = 0;
      let rowsTotal = 0;
      try {
        const { rows: list } = await db.query(
          "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name",
        );
        for (const { table_name: t } of list) {
          if (SKIP_TABLES.has(t)) continue;
          const { rows } = await db.query(`select * from "${t.replace(/"/g, '""')}"`);
          const cols = rows[0] ? Object.keys(rows[0]) : (await db.query(`select * from "${t.replace(/"/g, '""')}" limit 0`)).fields.map((f) => f.name);
          const lines = [cols.map(csvCell).join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))];
          writeFileSync(path.join(dataDir, `${t}.csv`), `﻿${lines.join("\r\n")}\r\n`);
          tables++;
          rowsTotal += rows.length;
        }
      } finally {
        await db.end();
      }
      writeFileSync(
        path.join(dataDir, "README.txt"),
        `Data export for ${dealer.name}, ${stamp}.\r\nOne CSV file per table (opens in Excel). Photos and documents are in the files-*.zip downloads.\r\n`,
      );
      const zip = path.join(work, "data.zip");
      zipDir(dataDir, zip);
      const key = `${base}${dealer.slug}-data-${stamp}.zip`;
      await r2Put(EXPORTS_BUCKET, "eu", key, readFileSync(zip));
      keys.push(key);
      await q("update dealers set export_keys = $2, updated_at = now() where id = $1", [dealer.id, JSON.stringify(keys)]);
      return `${tables} tables, ${rowsTotal} rows`;
    });

    await s.step("export_files", async () => {
      const objects = await r2List(bucketName, "eu");
      if (!objects.length) return "No files";
      let part = 0;
      let partDir = null;
      let partBytes = 0;
      const flush = async () => {
        if (!partDir) return;
        const zip = path.join(work, `files-${part}.zip`);
        zipDir(partDir, zip);
        const key = `${base}${dealer.slug}-files-${stamp}-${part}.zip`;
        await r2Put(EXPORTS_BUCKET, "eu", key, readFileSync(zip));
        keys.push(key);
        await q("update dealers set export_keys = $2, updated_at = now() where id = $1", [dealer.id, JSON.stringify(keys)]);
        rmSync(partDir, { recursive: true, force: true });
        rmSync(zip, { force: true });
        partDir = null;
        partBytes = 0;
      };
      for (const o of objects) {
        if (!partDir || partBytes + o.size > PART_BYTES) {
          await flush();
          part++;
          partDir = path.join(work, `files-${part}`);
          mkdirSync(partDir);
        }
        const body = await r2Get(bucketName, "eu", o.key);
        if (!body) continue;
        const dest = path.join(partDir, o.key.replace(/\.\.+/g, "_"));
        mkdirSync(path.dirname(dest), { recursive: true });
        writeFileSync(dest, body);
        partBytes += o.size;
      }
      await flush();
      return `${objects.length} files in ${part} download${part === 1 ? "" : "s"}`;
    });

    await q("update dealers set export_ready_at = now(), updated_at = now() where id = $1", [dealer.id]);
    await q("insert into audit_log (actor_email, dealer_id, action, detail) values ('removal job', $1, 'dealer.export_ready', $2)", [
      dealer.id,
      JSON.stringify({ runId, files: keys.length }),
    ]);
    console.log(`::notice title=Export ready::${dealer.name}: ${keys.length} download(s)`);
  } catch (err) {
    await s.fail(err);
    process.exitCode = 1;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function deleteExports(dealer) {
  let n = 0;
  for (const o of await r2List(EXPORTS_BUCKET, "eu", exportPrefix(dealer))) {
    await r2Delete(EXPORTS_BUCKET, "eu", o.key);
    n++;
  }
  await q("update dealers set export_keys = null, export_ready_at = null where id = $1", [dealer.id]);
  return n;
}

async function deleteDealer(dealer, runId) {
  const s = makeStepper(dealer.id, runId);
  const { workerName, bucketName, platformDomain } = dealerNames(dealer);
  try {
    await s.step("delete_addresses", async () => {
      const { rows } = await q("select * from dealer_domains where dealer_id = $1", [dealer.id]);
      if (!rows.length) return "None";
      const zones = await cfApi("GET", `/zones?name=${encodeURIComponent(platformDomain)}`);
      const zone = zones[0]?.id;
      if (zone) {
        const routes = await cfApi("GET", `/zones/${zone}/workers/routes`);
        for (const d of rows) {
          for (const r of routes.filter((r) => r.pattern === `${d.hostname}/*`)) {
            await cfApi("DELETE", `/zones/${zone}/workers/routes/${r.id}`).catch(() => {});
          }
          if (d.cf_hostname_id) await cfApi("DELETE", `/zones/${zone}/custom_hostnames/${d.cf_hostname_id}`).catch(() => {});
        }
      }
      await q("delete from dealer_domains where dealer_id = $1", [dealer.id]);
      return `${rows.length} removed`;
    });

    await s.step("delete_site", async () => ((await deleteWorker(dealer.worker_name || workerName)) ? `Worker ${workerName} deleted` : "Already gone"));

    await s.step("delete_files", async () => `${await r2DeleteBucket(bucketName, "eu")} files deleted with the bucket`);

    await s.step("delete_database", async () => {
      if (!dealer.neon_project_id) return "No database recorded";
      return (await neonDeleteProject(dealer.neon_project_id)) ? "Database deleted" : "Already gone";
    });

    await s.step("delete_email", async () => {
      if (!dealer.trekmail_domain_id) return "No email set up";
      if (!dealer.remove_email) return `Kept (${dealer.email_domain}) as chosen`;
      return (await trekmailDeleteDomain(dealer.trekmail_domain_id)) ? `${dealer.email_domain} and its mailboxes deleted` : "Already gone";
    });

    await s.step("delete_export", async () => `${await deleteExports(dealer)} export file(s) deleted`);

    await s.step("tidy_record", async () => {
      // Keep only that the dealer existed and when it was removed; no personal details.
      await q(
        `update dealers set status = 'deleted', removed_at = now(), updated_at = now(),
           contact_name = null, contact_email = null, contact_phone = null, billing_email = null,
           first_admin_email = 'removed', notes = null, platform_secret = null, neon_project_id = null,
           worker_name = null, site_url = null,
           trekmail_domain_id = case when remove_email then null else trekmail_domain_id end
         where id = $1`,
        [dealer.id],
      );
      await q("update audit_log set detail = null where dealer_id = $1", [dealer.id]);
      await q("insert into audit_log (actor_email, dealer_id, action, detail) values ('removal job', $1, 'dealer.deleted', null)", [dealer.id]);
      return "Personal details removed from the console";
    });
    console.log(`::notice title=Dealer deleted::${dealer.name}`);
  } catch (err) {
    const message = await s.fail(err);
    await q("insert into audit_log (actor_email, dealer_id, action, detail) values ('removal job', $1, 'dealer.delete_failed', $2)", [
      dealer.id,
      JSON.stringify({ runId, step: s.current, message }),
    ]).catch(() => {});
    process.exitCode = 1;
  }
}

export const DELETE_STEPS = ["delete_addresses", "delete_site", "delete_files", "delete_database", "delete_email", "delete_export", "tidy_record"];

try {
  if (mode === "export") {
    await exportDealer(await getDealer(Number(env("DEALER_ID"))), env("RUN_ID"));
  } else if (mode === "delete") {
    const dealer = await getDealer(Number(env("DEALER_ID")));
    if (dealer.status !== "suspended") throw new Error(`${dealer.name} isn't removed (status ${dealer.status}); not deleting.`);
    await deleteDealer(dealer, env("RUN_ID"));
  } else if (mode === "due") {
    const { rows: due } = await q("select * from dealers where status = 'suspended' and delete_after is not null and delete_after <= now()");
    for (const dealer of due) {
      const runId = `${Date.now()}`;
      await createSteps(dealer.id, runId, DELETE_STEPS);
      await deleteDealer(dealer, runId);
    }
    // Exports left behind by removals that were undone.
    const { rows: restored } = await q("select * from dealers where status = 'active' and export_keys is not null");
    for (const dealer of restored) await deleteExports(dealer);
    console.log(`::notice title=Daily removal check::${due.length} deleted, ${restored.length} old export(s) tidied`);
  } else {
    throw new Error(`Unknown MODE ${mode}`);
  }
} catch (err) {
  console.error(`Error: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
} finally {
  await consoleDb.end().catch(() => {});
}
