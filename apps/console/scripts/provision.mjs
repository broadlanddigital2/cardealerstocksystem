// Sets up ("provisions") one dealer. Run by the GitHub workflow "Set up dealer"
// (provision-dealer.yml), started from the console's Set up button.
//
// Each step reports to the console database (setup_steps) so the console shows
// progress. Steps are safe to re-run: anything already created is reused.
//
// Env: DEALER_ID, RUN_ID, CONSOLE_DATABASE_URL, NEON_API_KEY, SENDGRID_API_KEY,
//      CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, EMAIL_FROM, PLATFORM_DOMAIN
import { writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  buildSite,
  dealerNames,
  deployDealerSite,
  env,
  migrateDatabase,
  neon,
  neonDatabaseUrl,
  pgClient,
  waitHealthy,
  webDir,
  wrangler,
} from "./lib/dealer-site.mjs";

// Same data-scope id every dealer site uses (apps/web/server/middlewares/requireAuth.ts).
const SHARED_TENANT_ID = "user_3EdZv4RPs4Xi0cpKN6IiBWJ9dyz";
const MARGIN_WORDING = "Margin Scheme – Second-hand Goods. No VAT is separately charged or reclaimable on this invoice.";

const dealerId = Number(env("DEALER_ID"));
const runId = env("RUN_ID");
const consoleDb = pgClient(env("CONSOLE_DATABASE_URL"));
await consoleDb.connect();

let currentStep = null;
async function step(key, fn) {
  currentStep = key;
  await consoleDb.query(
    "update setup_steps set status = 'running', message = null, updated_at = now() where dealer_id = $1 and run_id = $2 and step = $3",
    [dealerId, runId, key],
  );
  console.log(`▶ ${key}`);
  const message = (await fn()) ?? null;
  await consoleDb.query(
    "update setup_steps set status = 'done', message = $4, updated_at = now() where dealer_id = $1 and run_id = $2 and step = $3",
    [dealerId, runId, key, message],
  );
  console.log(`✓ ${key}${message ? `: ${message}` : ""}`);
}

try {
  const { rows } = await consoleDb.query("select * from dealers where id = $1", [dealerId]);
  const dealer = rows[0];
  if (!dealer) throw new Error(`Dealer ${dealerId} not found`);
  const slug = dealer.slug;
  const { host, siteUrl, workerName, bucketName } = dealerNames(dealer);
  const platformSecret = dealer.platform_secret || randomBytes(32).toString("hex");
  let databaseUrl = "";

  await step("database", async () => {
    let projectId = dealer.neon_project_id;
    if (!projectId) {
      const created = await neon("POST", "/projects", {
        project: { name: `stockbook-${slug}`, region_id: "aws-eu-west-2", pg_version: 17 },
      });
      projectId = created.project.id;
      databaseUrl = created.connection_uris?.[0]?.connection_uri ?? "";
      await consoleDb.query("update dealers set neon_project_id = $2 where id = $1", [dealerId, projectId]);
    }
    if (!databaseUrl) databaseUrl = await neonDatabaseUrl(projectId);
    return `Neon project ${projectId}`;
  });

  await step("tables", async () => {
    await migrateDatabase(databaseUrl);
    return null;
  });

  await step("files", async () => {
    try {
      wrangler(["r2", "bucket", "create", bucketName, "--jurisdiction", "eu"]);
      return `Bucket ${bucketName} (EU)`;
    } catch (err) {
      if (/already exists|already own/i.test(err.output ?? err.message)) return `Bucket ${bucketName} already existed`;
      throw err;
    }
  });

  await step("site", async () => {
    buildSite();
    await deployDealerSite(consoleDb, dealer);
    await consoleDb.query("update dealers set worker_name = $2, release = $3, released_at = now() where id = $1", [
      dealerId,
      workerName,
      env("RELEASE", false) || null,
    ]);
    return `Worker ${workerName} at ${host}`;
  });

  await step("secrets", async () => {
    const secretsPath = path.join(webDir, ".dealer-secrets.json");
    writeFileSync(
      secretsPath,
      JSON.stringify({
        DATABASE_URL: databaseUrl,
        SENDGRID_API_KEY: env("SENDGRID_API_KEY", false),
        CRON_SECRET: randomBytes(32).toString("hex"),
        PLATFORM_SECRET: platformSecret,
      }),
    );
    try {
      wrangler(["secret", "bulk", ".dealer-secrets.json", "--config", "wrangler.dealer.json"]);
    } finally {
      rmSync(secretsPath, { force: true });
    }
    await consoleDb.query("update dealers set platform_secret = $2 where id = $1", [dealerId, platformSecret]);
    return null;
  });

  await step("settings", async () => {
    const db = pgClient(databaseUrl);
    await db.connect();
    try {
      await db.query(
        "insert into app_users (email, role) values ($1, 'admin') on conflict do nothing",
        [dealer.first_admin_email.toLowerCase()],
      );
      await db.query(
        `insert into dealer_settings (user_id, business_name, company_number, email, website, margin_scheme_wording)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (user_id) do update set business_name = excluded.business_name,
           company_number = coalesce(excluded.company_number, dealer_settings.company_number),
           email = coalesce(excluded.email, dealer_settings.email),
           website = coalesce(excluded.website, dealer_settings.website)`,
        [SHARED_TENANT_ID, dealer.name, dealer.company_number, dealer.contact_email, dealer.web_domain, MARGIN_WORDING],
      );
      await db.query(
        `insert into system_state (key, value) values ('site_modules', $1)
         on conflict (key) do update set value = excluded.value, updated_at = now()`,
        [
          JSON.stringify({
            ...(dealer.modules_on == null && dealer.modules_off == null
              ? { enabled: dealer.modules ?? [] }
              : { on: dealer.modules_on ?? [], off: dealer.modules_off ?? [] }),
            // Platform-wide tiers and on/off-for-everyone from the console's Modules page.
            catalogue: Object.fromEntries(
              (await consoleDb.query("select key, tier, enabled from module_settings")).rows.map((r) => [
                r.key,
                { tier: r.tier, enabled: r.enabled },
              ]),
            ),
          }),
        ],
      );
    } finally {
      await db.end();
    }
    return `${(dealer.modules ?? []).length} modules, first admin ${dealer.first_admin_email}`;
  });

  await step("check", async () => {
    // A new custom domain can take a few minutes to get its certificate.
    await waitHealthy(siteUrl, null, 5);
    return `${siteUrl} is up`;
  });

  await step("invite", async () => {
    const apiKey = env("SENDGRID_API_KEY", false);
    if (!apiKey) return "Skipped: SENDGRID_API_KEY not set";
    const signIn = `${siteUrl}/sign-in`;
    const resp = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: dealer.first_admin_email }] }],
        from: { email: env("EMAIL_FROM", false) || "noreply@racecargraphics.uk", name: dealer.name },
        subject: `Your ${dealer.name} stock book is ready`,
        content: [
          {
            type: "text/plain",
            value: `Your stock book is ready.\n\nSign in at ${signIn} with this email address (${dealer.first_admin_email}). We'll email you a 6-digit code, no password needed.\n\nYou're the admin: you can invite your staff under Settings → Users.`,
          },
          {
            type: "text/html",
            value: `<div style="font-family:Arial,sans-serif;line-height:1.5"><h2>Your stock book is ready</h2><p>Sign in with this email address (<strong>${dealer.first_admin_email}</strong>). We'll email you a 6-digit code, no password needed.</p><p><a href="${signIn}" style="display:inline-block;background:#157ABE;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:bold">Sign in</a></p><p>You're the admin: you can invite your staff under Settings → Users.</p></div>`,
          },
        ],
      }),
    });
    if (!resp.ok) throw new Error(`Invitation email failed (${resp.status}): ${(await resp.text()).slice(0, 200)}`);
    return `Sent to ${dealer.first_admin_email}`;
  });

  await consoleDb.query(
    "update dealers set status = 'active', site_url = $2, provisioned_at = now(), updated_at = now() where id = $1",
    [dealerId, siteUrl],
  );
  await consoleDb.query(
    "insert into audit_log (actor_email, dealer_id, action, detail) values ('setup job', $1, 'dealer.setup_finished', $2)",
    [dealerId, JSON.stringify({ runId, siteUrl })],
  );
  console.log(`::notice title=Dealer set up::${dealer.name} is live at ${siteUrl}`);
} catch (err) {
  const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
  console.error(`Error: setup failed at ${currentStep}: ${message}`);
  if (err?.output) console.error(err.output.slice(-3000));
  await consoleDb
    .query(
      "update setup_steps set status = 'failed', message = $4, updated_at = now() where dealer_id = $1 and run_id = $2 and step = $3",
      [dealerId, runId, currentStep ?? "database", message],
    )
    .catch(() => {});
  await consoleDb.query("update dealers set status = 'failed', updated_at = now() where id = $1", [dealerId]).catch(() => {});
  await consoleDb
    .query(
      "insert into audit_log (actor_email, dealer_id, action, detail) values ('setup job', $1, 'dealer.setup_failed', $2)",
      [dealerId, JSON.stringify({ runId, step: currentStep, message })],
    )
    .catch(() => {});
  process.exitCode = 1;
} finally {
  await consoleDb.end().catch(() => {});
}
