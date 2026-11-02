// Cloudflare (REST + R2 over its S3 interface), Neon and TrekMail calls used by
// the removal job (offboard.mjs).
import { createHash } from "node:crypto";
import { AwsClient } from "aws4fetch";
import { env } from "./dealer-site.mjs";

export async function cfApi(method, path, body, headers = {}) {
  const resp = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: { Authorization: `Bearer ${env("CLOUDFLARE_API_TOKEN")}`, "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok || !data?.success) {
    const msg = data?.errors?.map((e) => `${e.message} (${e.code})`).join("; ") || `HTTP ${resp.status}`;
    const err = new Error(`Cloudflare ${method} ${path}: ${msg}`);
    err.status = resp.status;
    err.codes = (data?.errors ?? []).map((e) => e.code);
    throw err;
  }
  return data.result;
}

const account = () => env("CLOUDFLARE_ACCOUNT_ID");

// ---- R2 through its S3 interface (credentials derived from the API token) ----
let s3;
async function s3Client() {
  if (s3) return s3;
  const token = env("CLOUDFLARE_API_TOKEN");
  let id;
  try {
    id = (await cfApi("GET", "/user/tokens/verify")).id;
  } catch {
    id = (await cfApi("GET", `/accounts/${account()}/tokens/verify`)).id;
  }
  s3 = new AwsClient({
    accessKeyId: id,
    secretAccessKey: createHash("sha256").update(token).digest("hex"),
    service: "s3",
    region: "auto",
  });
  return s3;
}

const endpoint = (jurisdiction) =>
  `https://${account()}.${jurisdiction === "eu" ? "eu." : ""}r2.cloudflarestorage.com`;
const keyPath = (key) => key.split("/").map(encodeURIComponent).join("/");

async function s3fetch(jurisdiction, path, init = {}) {
  const client = await s3Client();
  const resp = await client.fetch(`${endpoint(jurisdiction)}${path}`, init);
  if (!resp.ok && resp.status !== 404) throw new Error(`R2 ${init.method ?? "GET"} ${path}: HTTP ${resp.status} ${(await resp.text()).slice(0, 200)}`);
  return resp;
}

const xmlAll = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => m[1]);
const unxml = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** Every object in a bucket: [{ key, size }]. Missing bucket = []. */
export async function r2List(bucket, jurisdiction, prefix = "") {
  const out = [];
  let token = "";
  for (;;) {
    const q = new URLSearchParams({ "list-type": "2", "max-keys": "1000", ...(prefix ? { prefix } : {}), ...(token ? { "continuation-token": token } : {}) });
    const resp = await s3fetch(jurisdiction, `/${bucket}?${q}`);
    if (resp.status === 404) return out;
    const xml = await resp.text();
    for (const c of xmlAll(xml, "Contents")) {
      out.push({ key: unxml(xmlAll(c, "Key")[0] ?? ""), size: Number(xmlAll(c, "Size")[0] ?? 0) });
    }
    if (!/<IsTruncated>true<\/IsTruncated>/.test(xml)) return out;
    token = unxml(xmlAll(xml, "NextContinuationToken")[0] ?? "");
    if (!token) return out;
  }
}

export async function r2Get(bucket, jurisdiction, key) {
  const resp = await s3fetch(jurisdiction, `/${bucket}/${keyPath(key)}`);
  if (resp.status === 404) return null;
  return Buffer.from(await resp.arrayBuffer());
}

export async function r2Put(bucket, jurisdiction, key, body, contentType = "application/zip") {
  await s3fetch(jurisdiction, `/${bucket}/${keyPath(key)}`, { method: "PUT", body, headers: { "content-type": contentType } });
}

export async function r2Delete(bucket, jurisdiction, key) {
  await s3fetch(jurisdiction, `/${bucket}/${keyPath(key)}`, { method: "DELETE" });
}

/** Creates the bucket if it doesn't exist (EU jurisdiction). */
export async function r2EnsureBucket(name) {
  try {
    await cfApi("POST", `/accounts/${account()}/r2/buckets`, { name, locationHint: "weur" }, { "cf-r2-jurisdiction": "eu" });
  } catch (err) {
    if (!/already exists|10004/i.test(err.message)) throw err;
  }
}

/** Empties and deletes a bucket. Returns how many files were removed. */
export async function r2DeleteBucket(name, jurisdiction) {
  let removed = 0;
  for (;;) {
    const objects = await r2List(name, jurisdiction);
    if (!objects.length) break;
    for (const o of objects) {
      await r2Delete(name, jurisdiction, o.key);
      removed++;
    }
  }
  try {
    await cfApi("DELETE", `/accounts/${account()}/r2/buckets/${name}`, undefined, jurisdiction === "eu" ? { "cf-r2-jurisdiction": "eu" } : {});
  } catch (err) {
    if (err.status !== 404 && !/does not exist|10006/i.test(err.message)) throw err;
  }
  return removed;
}

// ---- Workers ----

/** Removes a Worker with its custom domains. Missing Worker is fine. */
export async function deleteWorker(name) {
  try {
    const domains = await cfApi("GET", `/accounts/${account()}/workers/domains?service=${encodeURIComponent(name)}`);
    for (const d of domains ?? []) await cfApi("DELETE", `/accounts/${account()}/workers/domains/${d.id}`);
  } catch (err) {
    if (err.status !== 404) throw err;
  }
  try {
    await cfApi("DELETE", `/accounts/${account()}/workers/scripts/${name}?force=true`);
    return true;
  } catch (err) {
    if (err.status === 404 || err.codes?.includes(10007)) return false;
    throw err;
  }
}

// ---- Neon ----
export async function neonDeleteProject(projectId) {
  const resp = await fetch(`https://console.neon.tech/api/v2/projects/${projectId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${env("NEON_API_KEY")}`, Accept: "application/json" },
  });
  if (resp.status === 404) return false;
  if (!resp.ok) throw new Error(`Neon delete project failed (${resp.status}): ${(await resp.text()).slice(0, 200)}`);
  return true;
}

// ---- TrekMail ----
export async function trekmailDeleteDomain(domainId) {
  const resp = await fetch(`https://trekmail.net/api/v1/domains/${domainId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${env("TREKMAIL_API_TOKEN")}`,
      Accept: "application/json",
      "Idempotency-Key": `remove-domain-${domainId}`,
      "X-Confirm-Delete": "true",
    },
  });
  if (resp.status === 404) return false;
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(`TrekMail: ${[body?.error?.message, body?.error?.hint].filter(Boolean).join(" ") || `HTTP ${resp.status}`}`);
  }
  return true;
}
