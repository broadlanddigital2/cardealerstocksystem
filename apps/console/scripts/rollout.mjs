// Releases one version of the stock book to every dealer, each in its own
// separate Worker and database (nothing is shared or copied between dealers).
//
//   wave 1: pilot dealers. If any of them fails, the release stops there.
//   wave 2: everyone else, one at a time. A failure is recorded and the
//           remaining dealers still update.
// For each dealer: apply new database migrations to that dealer's own database,
// deploy the new code to that dealer's own Worker, then wait for its health
// check to report the new release with a working database.
//
// Progress is written to the console database (rollouts, rollout_dealers), so
// the console's Releases page shows it.
//
// Env: CONSOLE_DATABASE_URL, NEON_API_KEY, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID,
//      RELEASE (git commit), RELEASE_TITLE, STARTED_BY, GITHUB_RUN_URL,
//      ROLLOUT_ID (when started from the console), DEALER_ID (one dealer only), FORCE ("true": redeploy even if already on this release)
import {
  buildSite,
  deployDealerSite,
  env,
  migrateDatabase,
  neonDatabaseUrl,
  pgClient,
  waitHealthy,
} from "./lib/dealer-site.mjs";

const release = env("RELEASE");
const force = env("FORCE", false) === "true";
const onlyDealer = Number(env("DEALER_ID", false)) || null;
const consoleDb = pgClient(env("CONSOLE_DATABASE_URL"));
await consoleDb.connect();

const q = (text, params) => consoleDb.query(text, params);
let rolloutId = Number(env("ROLLOUT_ID", false)) || null;

async function finish(status, message) {
  await q("update rollouts set status = $2, message = $3, finished_at = now() where id = $1", [rolloutId, status, message]);
  console.log(`${status === "done" ? "✓" : "✘"} ${message}`);
}

async function setDealer(dealerId, status, message = null) {
  await q(
    "update rollout_dealers set status = $3, message = $4, updated_at = now() where rollout_id = $1 and dealer_id = $2",
    [rolloutId, dealerId, status, message],
  );
}

async function releaseTo(dealer) {
  if (!force && dealer.release === release) {
    await setDealer(dealer.id, "skipped", "Already on this release");
    return true;
  }
  await setDealer(dealer.id, "running", "Updating database");
  try {
    if (!dealer.neon_project_id) throw new Error("No database recorded for this dealer.");
    const databaseUrl = await neonDatabaseUrl(dealer.neon_project_id);
    await migrateDatabase(databaseUrl);
    await setDealer(dealer.id, "running", "Deploying");
    const { siteUrl } = await deployDealerSite(consoleDb, dealer);
    await setDealer(dealer.id, "running", "Checking the site");
    await waitHealthy(siteUrl, release, 5);
    await q("update dealers set release = $2, released_at = now(), updated_at = now() where id = $1", [dealer.id, release]);
    await setDealer(dealer.id, "done", `Live on ${release.slice(0, 7)}`);
    console.log(`✓ ${dealer.name}`);
    return true;
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    await setDealer(dealer.id, "failed", message);
    console.error(`Error: ${dealer.name}: ${message}`);
    if (err?.output) console.error(err.output.slice(-2000));
    return false;
  }
}

try {
  const { rows: dealers } = await q(
    `select * from dealers where status = 'active' and worker_name is not null ${onlyDealer ? "and id = $1" : ""}
     order by pilot desc, name`,
    onlyDealer ? [onlyDealer] : [],
  );

  if (!rolloutId) {
    const { rows } = await q(
      "insert into rollouts (release, title, started_by, github_run_url) values ($1, $2, $3, $4) returning id",
      [release, env("RELEASE_TITLE", false) || null, env("STARTED_BY", false) || "release pipeline", env("GITHUB_RUN_URL", false) || null],
    );
    rolloutId = rows[0].id;
  } else {
    await q("update rollouts set release = $2, github_run_url = coalesce($3, github_run_url) where id = $1", [
      rolloutId,
      release,
      env("GITHUB_RUN_URL", false) || null,
    ]);
  }
  await q("delete from rollout_dealers where rollout_id = $1", [rolloutId]);
  for (const d of dealers) {
    await q("insert into rollout_dealers (rollout_id, dealer_id, wave) values ($1, $2, $3)", [rolloutId, d.id, d.pilot ? 1 : 2]);
  }

  if (!dealers.length) {
    await finish("done", "No dealers to update.");
  } else if (!force && dealers.every((d) => d.release === release)) {
    for (const d of dealers) await setDealer(d.id, "skipped", "Already on this release");
    await finish("done", "Every dealer is already on this release.");
  } else {
    buildSite(); // one build, deployed to each dealer's own Worker

    const pilots = dealers.filter((d) => d.pilot);
    const rest = dealers.filter((d) => !d.pilot);
    let failed = 0;
    for (const d of pilots) if (!(await releaseTo(d))) failed++;

    if (failed) {
      for (const d of rest) await setDealer(d.id, "skipped", "Not updated: a pilot dealer failed");
      await finish("stopped", `Stopped after the pilot dealers: ${failed} failed. Nobody else was updated.`);
      process.exitCode = 1;
    } else {
      for (const d of rest) if (!(await releaseTo(d))) failed++;
      if (failed) {
        await finish("failed", `${dealers.length - failed} of ${dealers.length} dealers updated; ${failed} failed.`);
        process.exitCode = 1;
      } else {
        await finish("done", `${dealers.length} ${dealers.length === 1 ? "dealer" : "dealers"} on ${release.slice(0, 7)}.`);
      }
    }
  }
} catch (err) {
  const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
  console.error(`Error: release failed: ${message}`);
  if (err?.output) console.error(err.output.slice(-3000));
  if (rolloutId) {
    await q("update rollout_dealers set status = 'skipped', message = 'Release stopped' where rollout_id = $1 and status in ('waiting', 'running')", [rolloutId]).catch(() => {});
    await finish("failed", message).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  await consoleDb.end().catch(() => {});
}
