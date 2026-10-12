// Copies every row of every app table (schema "public") from SOURCE_DATABASE_URL
// to DATABASE_URL. The target must already have the schema (run migrate first).
//
// - Tables are copied parents-first, following foreign keys.
// - JSON columns are re-encoded so arrays survive the trip.
// - Serial ID sequences are moved past the highest copied ID.
// - Refuses to touch a target that already has rows unless OVERWRITE=1, in
//   which case the target tables are emptied first.
// - Everything is written in one transaction: all of it lands, or none.
import pg from "pg";

function client(raw, label) {
  if (!raw) {
    console.error(`Error: ${label} is not set`);
    process.exit(1);
  }
  const url = new URL(raw);
  const isLocal = /^(localhost|127\.0\.0\.1)$/.test(url.hostname);
  return new pg.Client({
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, "") || "postgres",
    ssl: isLocal ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 20_000,
  });
}

const source = client(process.env.SOURCE_DATABASE_URL, "SOURCE_DATABASE_URL");
const target = client(process.env.DATABASE_URL, "DATABASE_URL");
const overwrite = process.env.OVERWRITE === "1";
const q = (name) => `"${name.replace(/"/g, '""')}"`;

async function tables(c) {
  const r = await c.query(
    `select table_name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
  );
  return r.rows.map((x) => x.table_name);
}

// Parents before children, using the target's foreign keys.
async function copyOrder(names) {
  const r = await target.query(`
    select tc.table_name as child, ccu.table_name as parent
    from information_schema.table_constraints tc
    join information_schema.constraint_column_usage ccu
      on tc.constraint_name = ccu.constraint_name and tc.table_schema = ccu.table_schema
    where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'`);
  const deps = new Map(names.map((n) => [n, new Set()]));
  for (const { child, parent } of r.rows) {
    if (child !== parent && deps.has(child) && deps.has(parent)) deps.get(child).add(parent);
  }
  const out = [];
  const seen = new Set();
  const visit = (n, stack = new Set()) => {
    if (seen.has(n)) return;
    if (stack.has(n)) throw new Error(`foreign key cycle at ${n}`);
    stack.add(n);
    for (const p of deps.get(n)) visit(p, stack);
    stack.delete(n);
    seen.add(n);
    out.push(n);
  };
  names.forEach((n) => visit(n));
  return out;
}

async function columns(c, table) {
  const r = await c.query(
    `select column_name, data_type, column_default, is_generated
     from information_schema.columns
     where table_schema = 'public' and table_name = $1 order by ordinal_position`,
    [table],
  );
  return r.rows;
}

const summary = [];
try {
  await source.connect();
  await target.connect();

  const sourceTables = new Set(await tables(source));
  const targetTables = await tables(target);
  const order = await copyOrder(targetTables);

  // Safety: never mix into a target that already has data.
  const nonEmpty = [];
  for (const t of order) {
    const n = (await target.query(`select count(*)::int as n from ${q(t)}`)).rows[0].n;
    if (n > 0) nonEmpty.push(`${t} (${n})`);
  }
  if (nonEmpty.length && !overwrite) {
    throw new Error(
      `target already has rows in: ${nonEmpty.join(", ")}. Re-run with "overwrite" ticked to replace them.`,
    );
  }

  await target.query("begin");
  if (overwrite && nonEmpty.length) {
    await target.query(`truncate ${order.map(q).join(", ")} restart identity cascade`);
  }

  for (const t of order) {
    if (!sourceTables.has(t)) {
      summary.push(`${t}: not in source, skipped`);
      continue;
    }
    const targetCols = (await columns(target, t)).filter((c) => c.is_generated !== "ALWAYS");
    const sourceColNames = new Set((await columns(source, t)).map((c) => c.column_name));
    const cols = targetCols.filter((c) => sourceColNames.has(c.column_name));
    const json = new Set(cols.filter((c) => c.data_type === "json" || c.data_type === "jsonb").map((c) => c.column_name));

    const rows = (await source.query(`select ${cols.map((c) => q(c.column_name)).join(", ")} from ${q(t)}`)).rows;
    const batch = Math.max(1, Math.floor(30_000 / Math.max(cols.length, 1)));
    for (let i = 0; i < rows.length; i += batch) {
      const chunk = rows.slice(i, i + batch);
      const params = [];
      const tuples = chunk.map((row) => {
        const ph = cols.map((c) => {
          let v = row[c.column_name];
          if (json.has(c.column_name) && v !== null && v !== undefined) v = JSON.stringify(v);
          params.push(v);
          return `$${params.length}`;
        });
        return `(${ph.join(", ")})`;
      });
      await target.query(
        `insert into ${q(t)} (${cols.map((c) => q(c.column_name)).join(", ")}) values ${tuples.join(", ")}`,
        params,
      );
    }

    // Move serial sequences past the copied IDs.
    for (const c of cols.filter((c) => (c.column_default ?? "").startsWith("nextval("))) {
      await target.query(
        `select setval(pg_get_serial_sequence($1, $2), coalesce((select max(${q(c.column_name)}) from ${q(t)}), 1),
                (select max(${q(c.column_name)}) from ${q(t)}) is not null)`,
        [`public.${q(t)}`, c.column_name],
      );
    }
    summary.push(`${t}: ${rows.length} rows`);
  }

  await target.query("commit");
  console.log("Copied:\n  " + summary.join("\n  "));
  console.log(`::notice title=Data copied::${summary.join(" · ")}`);
} catch (err) {
  await target.query("rollback").catch(() => {});
  console.error("Error: copy failed:", err?.message ?? err);
  if (err?.code) console.error("Error: postgres code:", err.code, err.detail ?? "", err.table ?? "");
  process.exitCode = 1;
} finally {
  await source.end().catch(() => {});
  await target.end().catch(() => {});
}
