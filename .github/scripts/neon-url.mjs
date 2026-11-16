#!/usr/bin/env node
// Prints a current connection string for a Neon project's branch, using the
// Neon API (NEON_API_KEY), so workflows never depend on a stored password.
//
//   node .github/scripts/neon-url.mjs <project name> <branch name> [--create] [--env NAME]
//
// --create: if the branch doesn't exist, create it from the project's default
// (production) branch with a read-write compute. Branches used here are kept:
// any automatic expiry on them is removed.
// --env NAME: write NAME=<connection string> to $GITHUB_ENV for later steps
// (default DATABASE_URL). The string is masked in the GitHub log.
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
const [projectName, branchName] = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--env");
const flag = args.includes("--create") ? "--create" : "";
const envName = args.includes("--env") ? args[args.indexOf("--env") + 1] : "DATABASE_URL";
const key = process.env.NEON_API_KEY;
if (!projectName || !branchName) {
  console.error("usage: neon-url.mjs <project> <branch> [--create]");
  process.exit(2);
}
if (!key) {
  console.error("NEON_API_KEY is not set");
  process.exit(2);
}

async function neon(method, path, body) {
  const resp = await fetch(`https://console.neon.tech/api/v2${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Neon API ${method} ${path} failed (${resp.status}): ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { projects } = await neon("GET", `/projects?search=${encodeURIComponent(projectName)}&limit=100`);
const project = projects.find((p) => p.name === projectName);
if (!project) throw new Error(`No Neon project called ${projectName}`);

let { branches } = await neon("GET", `/projects/${project.id}/branches`);
let branch = branches.find((b) => b.name === branchName);
if (!branch) {
  if (flag !== "--create") throw new Error(`Neon project ${projectName} has no branch ${branchName}`);
  const parent = branches.find((b) => b.default) ?? branches[0];
  console.error(`Creating branch ${branchName} in ${projectName} from ${parent.name} (kept, no expiry)…`);
  const created = await neon("POST", `/projects/${project.id}/branches`, {
    branch: { name: branchName, parent_id: parent.id },
    endpoints: [{ type: "read_write" }],
  });
  branch = created.branch;
  console.log(`::notice title=Neon branch created::${projectName} / ${branchName} (copy of ${parent.name}, no automatic expiry)`);
} else if (branch.expires_at) {
  await neon("PATCH", `/projects/${project.id}/branches/${branch.id}`, { branch: { expires_at: null } });
  console.log(`::notice title=Neon branch kept::Removed automatic expiry from ${projectName} / ${branchName}`);
}

// A branch needs a read-write compute to be connected to.
const { endpoints } = await neon("GET", `/projects/${project.id}/endpoints`);
if (!endpoints.some((e) => e.branch_id === branch.id && e.type === "read_write")) {
  await neon("POST", `/projects/${project.id}/endpoints`, { endpoint: { branch_id: branch.id, type: "read_write" } });
  console.log(`::notice title=Neon compute added::${projectName} / ${branchName}`);
}

const { databases } = await neon("GET", `/projects/${project.id}/branches/${branch.id}/databases`);
const db = databases.find((d) => d.name === "neondb") ?? databases[0];
let uri;
for (let attempt = 0; attempt < 30 && !uri; attempt++) {
  try {
    uri = (
      await neon(
        "GET",
        `/projects/${project.id}/connection_uri?branch_id=${branch.id}&database_name=${encodeURIComponent(db.name)}&role_name=${encodeURIComponent(db.owner_name)}`,
      )
    ).uri;
  } catch (err) {
    if (attempt === 29) throw err;
    await sleep(4000); // a new branch / compute takes a few seconds to be ready
  }
}
console.log(`::add-mask::${uri}`);
const pw = new URL(uri).password;
if (pw) console.log(`::add-mask::${decodeURIComponent(pw)}`);
const full = uri.includes("sslmode=") ? uri : `${uri}${uri.includes("?") ? "&" : "?"}sslmode=require`;
if (!process.env.GITHUB_ENV) throw new Error("GITHUB_ENV is not set (run inside GitHub Actions)");
appendFileSync(process.env.GITHUB_ENV, `${envName}=${full}\n`);
console.log(`Connection for ${projectName} / ${branchName} ready in ${envName} (${new URL(full).hostname}).`);
