// Shared by the setup job (provision.mjs) and the release job (rollout.mjs), so a
// dealer's site is always built and deployed the same way.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "../../../..");
export const webDir = path.join(repoRoot, "apps/web");
export const CRONS = ["*/15 * * * *", "*/30 * * * *", "0 6 * * *"];

export const env = (k, required = true) => {
  const v = process.env[k];
  if (required && !v) throw new Error(`${k} is not set`);
  return v ?? "";
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function pgClient(raw) {
  const url = new URL(raw);
  const isLocal = /^(localhost|127\.0\.0\.1)$/.test(url.hostname);
  return new pg.Client({
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, "") || "postgres",
    ssl: isLocal ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 30_000,
  });
}

export async function neon(method, apiPath, body) {
  const resp = await fetch(`https://console.neon.tech/api/v2${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${env("NEON_API_KEY")}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Neon API ${method} ${apiPath} failed (${resp.status}): ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

/** Connection string for a dealer's database (default branch, first database). */
export async function neonDatabaseUrl(projectId) {
  const branches = await neon("GET", `/projects/${projectId}/branches`);
  const branch = branches.branches.find((b) => b.default) ?? branches.branches[0];
  const dbs = await neon("GET", `/projects/${projectId}/branches/${branch.id}/databases`);
  const database = dbs.databases[0];
  const uri = await neon(
    "GET",
    `/projects/${projectId}/connection_uri?branch_id=${branch.id}&database_name=${encodeURIComponent(database.name)}&role_name=${encodeURIComponent(database.owner_name)}`,
  );
  return uri.uri;
}

export function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", ...opts });
}

export function wrangler(args, extraEnv = {}) {
  try {
    return run("pnpm", ["--filter", "@workspace/web", "exec", "wrangler", ...args], { env: { ...process.env, ...extraEnv } });
  } catch (err) {
    const out = `${err.stdout ?? ""}\n${err.stderr ?? ""}`;
    const e = new Error(out.split("\n").filter((l) => /ERROR|error|✘/.test(l)).slice(0, 4).join(" ").slice(0, 400) || err.message);
    e.output = out;
    throw e;
  }
}

/** Builds the dealer site once (the build is the same for every dealer). */
export function buildSite() {
  run("pnpm", ["--filter", "@workspace/web", "exec", "opennextjs-cloudflare", "build"], {
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  });
}

/** Applies database migrations to one dealer's own database. */
export async function migrateDatabase(databaseUrl) {
  let lastErr;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      run("pnpm", ["--filter", "@workspace/db", "run", "migrate"], { env: { ...process.env, DATABASE_URL: databaseUrl } });
      return;
    } catch (err) {
      lastErr = err;
      await sleep(attempt * 5000); // a brand-new database can take a moment to accept connections
    }
  }
  throw new Error(
    `Migrations failed: ${`${lastErr.stdout ?? ""}${lastErr.stderr ?? ""}`.split("\n").filter((l) => /Error/.test(l)).join(" ").slice(0, 300)}`,
  );
}

export function dealerNames(dealer) {
  const platformDomain = env("PLATFORM_DOMAIN", false) || "racecargraphics.uk";
  const host = dealer.staff_domain || `${dealer.slug}-stockbook.${platformDomain}`;
  return {
    platformDomain,
    host,
    siteUrl: `https://${host}`,
    workerName: `stockbook-${dealer.slug}`,
    bucketName: `stockbook-${dealer.slug}-files`,
  };
}

/** Writes wrangler.dealer.json for this dealer and deploys the already-built site to its own Worker. */
export async function deployDealerSite(consoleDb, dealer) {
  const { platformDomain, host, siteUrl, workerName, bucketName } = dealerNames(dealer);
  const ownDomains = (
    await consoleDb.query("select hostname from dealer_domains where dealer_id = $1 order by id", [dealer.id])
  ).rows.map((r) => r.hostname);
  const baseConfig = readFileSync(path.join(webDir, "wrangler.jsonc"), "utf8");
  const compatibilityDate = /"compatibility_date"\s*:\s*"([^"]+)"/.exec(baseConfig)?.[1] ?? "2026-09-27";
  const config = {
    name: workerName,
    main: "worker.ts",
    compatibility_date: compatibilityDate,
    compatibility_flags: ["nodejs_compat"],
    assets: { directory: ".open-next/assets", binding: "ASSETS" },
    observability: { enabled: true },
    routes: [
      { pattern: host, custom_domain: true },
      // The dealer's own addresses (added in the console) must survive a redeploy.
      ...ownDomains.map((h) => ({ pattern: `${h}/*`, zone_name: platformDomain })),
    ],
    r2_buckets: [{ binding: "FILES", bucket_name: bucketName, jurisdiction: "eu" }],
    triggers: { crons: CRONS },
    vars: {
      APP_URL: siteUrl,
      ENQUIRY_EMAIL_FROM: env("EMAIL_FROM", false) || "noreply@racecargraphics.uk",
      EMAIL_FROM_NAME: dealer.name,
      RAPID_CAR_CHECK_DOMAIN: "motormetric-mg.co.uk",
      RELEASE: env("RELEASE", false) || "",
    },
  };
  writeFileSync(path.join(webDir, "wrangler.dealer.json"), JSON.stringify(config, null, 2));
  wrangler(["deploy", "--config", "wrangler.dealer.json"]);
  return { host, siteUrl, workerName };
}

/** Waits for the dealer's site to answer healthy (and, if given, on this release). */
export async function waitHealthy(siteUrl, release, minutes = 5) {
  let last = "no answer";
  for (let attempt = 1; attempt <= minutes * 6; attempt++) {
    try {
      const resp = await fetch(`${siteUrl}/api/healthz`, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
      const body = await resp.json().catch(() => ({}));
      if (resp.ok && (!release || body.release === release)) return;
      last = resp.ok ? `still on release ${String(body.release ?? "unknown").slice(0, 7)}` : `HTTP ${resp.status}${body.database ? ` (database ${body.database})` : ""}`;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await sleep(10_000);
  }
  throw new Error(`${siteUrl} wasn't healthy after ${minutes} minutes: ${last}`);
}
