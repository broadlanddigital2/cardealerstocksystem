/**
 * Database access over Supabase's HTTPS API (PostgREST), the same way our other
 * Cloudflare sites talk to Supabase: no direct Postgres connection, just the
 * project URL and the service-role key.
 *
 * It exposes the small part of Drizzle's query-builder API this app uses
 * (select / insert / update / delete / where / orderBy / limit / returning /
 * onConflictDoUpdate / transaction) on top of supabase-js, and converts rows to
 * exactly the shapes Drizzle produced (camelCase keys, numeric columns as
 * strings, timestamps as Date). That keeps the stock-book, VAT and invoice
 * logic in the route handlers unchanged.
 *
 * The Drizzle table definitions in ./schema remain the source of truth for the
 * schema and for generated SQL migrations.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getTableColumns, getTableName, type Column } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

let client: SupabaseClient | null = null;

function supabase(): SupabaseClient {
  if (!client) {
    const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
    if (!url || !key) {
      throw new Error("Database is not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
    }
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return client;
}

// ---------------------------------------------------------------------------
// Errors (mirror the pg error fields the route handlers inspect)
// ---------------------------------------------------------------------------

export class DbError extends Error {
  code?: string;
  constraint?: string;
  detail?: string;
  hint?: string;
  constructor(e: { message: string; code?: string; details?: string | null; hint?: string | null }) {
    super(e.message);
    this.name = "DbError";
    this.code = e.code;
    this.detail = e.details ?? undefined;
    this.hint = e.hint ?? undefined;
    const m = /constraint "([^"]+)"/.exec(e.message);
    if (m) this.constraint = m[1];
  }
}

function check<T>(res: { data: T; error: { message: string; code?: string; details?: string | null; hint?: string | null } | null }): T {
  if (res.error) throw new DbError(res.error);
  return res.data;
}

// ---------------------------------------------------------------------------
// Column metadata & row conversion
// ---------------------------------------------------------------------------

type AnyColumn = Column;

interface TableMeta {
  name: string;
  columns: Record<string, AnyColumn>; // camelCase key -> column
  byDbName: Record<string, string>; // db name -> camelCase key
  pk: string; // camelCase key of the primary key
}

const metaCache = new WeakMap<object, TableMeta>();

function meta(table: PgTable): TableMeta {
  let m = metaCache.get(table);
  if (!m) {
    const columns = getTableColumns(table) as Record<string, AnyColumn>;
    const byDbName: Record<string, string> = {};
    let pk = "";
    for (const [key, col] of Object.entries(columns)) {
      byDbName[col.name] = key;
      if (col.primary) pk = key;
    }
    m = { name: getTableName(table), columns, byDbName, pk: pk || "id" };
    metaCache.set(table, m);
  }
  return m;
}

function columnTable(col: AnyColumn): PgTable {
  return (col as unknown as { table: PgTable }).table;
}

function fromDb(col: AnyColumn | undefined, value: unknown): unknown {
  if (value === null || value === undefined || !col) return value ?? null;
  switch (col.columnType) {
    case "PgNumeric":
      return typeof value === "string" ? value : String(value);
    case "PgTimestamp":
      return new Date(value as string);
    case "PgBigInt53":
      return typeof value === "number" ? value : Number(value);
    default:
      return value;
  }
}

function toDb(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  return value;
}

/** camelCase row from the API -> Drizzle-shaped row. */
function rowFromDb(m: TableMeta, raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [dbName, value] of Object.entries(raw)) {
    const key = m.byDbName[dbName] ?? dbName;
    out[key] = fromDb(m.columns[key], value);
  }
  return out;
}

/** Drizzle-shaped values -> snake_case payload (undefined keys dropped). */
function rowToDb(m: TableMeta, values: Record<string, unknown>, opts: { applyOnUpdate?: boolean } = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    const col = m.columns[key];
    if (!col) throw new Error(`Unknown column "${key}" on table ${m.name}`);
    out[col.name] = toDb(value);
  }
  if (opts.applyOnUpdate) {
    for (const [key, col] of Object.entries(m.columns)) {
      const fn = (col as unknown as { onUpdateFn?: () => unknown }).onUpdateFn;
      if (fn && !(col.name in out) && values[key] === undefined) out[col.name] = toDb(fn());
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Conditions (subset of drizzle-orm operators)
// ---------------------------------------------------------------------------

type Op = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "like" | "ilike" | "is" | "isnot" | "in";

export type Condition =
  | { kind: "cmp"; op: Op; col: AnyColumn; value: unknown }
  | { kind: "and"; conds: Condition[] }
  | { kind: "or"; conds: Condition[] };

const cmp = (op: Op) => (col: AnyColumn, value: unknown): Condition => ({ kind: "cmp", op, col, value });

export const eq = cmp("eq");
export const ne = cmp("neq");
export const gt = cmp("gt");
export const gte = cmp("gte");
export const lt = cmp("lt");
export const lte = cmp("lte");
export const like = (col: AnyColumn, pattern: string): Condition => ({ kind: "cmp", op: "like", col, value: pattern });
export const ilike = (col: AnyColumn, pattern: string): Condition => ({ kind: "cmp", op: "ilike", col, value: pattern });
export const isNull = (col: AnyColumn): Condition => ({ kind: "cmp", op: "is", col, value: null });
export const isNotNull = (col: AnyColumn): Condition => ({ kind: "cmp", op: "isnot", col, value: null });
export const inArray = (col: AnyColumn, values: unknown[]): Condition => ({ kind: "cmp", op: "in", col, value: values });

function compact(conds: Array<Condition | undefined>): Condition[] {
  return conds.filter((c): c is Condition => Boolean(c));
}
export const and = (...conds: Array<Condition | undefined>): Condition => ({ kind: "and", conds: compact(conds) });
export const or = (...conds: Array<Condition | undefined>): Condition => ({ kind: "or", conds: compact(conds) });

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}
/** Case-insensitive equality, i.e. `lower(col) = lower(value)`. */
export const equalsIgnoreCase = (col: AnyColumn, value: string): Condition => ilike(col, escapeLike(value));
/** Case-insensitive substring match, i.e. `lower(col) like '%value%'`. */
export const containsIgnoreCase = (col: AnyColumn, value: string): Condition => ilike(col, `%${escapeLike(value)}%`);

type Order = { col: AnyColumn; ascending: boolean };
export const desc = (col: AnyColumn): Order => ({ col, ascending: false });
export const asc = (col: AnyColumn): Order => ({ col, ascending: true });

// PostgREST logic-tree value quoting (used inside or=(...)).
function quote(v: unknown): string {
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /[,.:()"\\\s]/.test(s) ? `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : s;
}

function treeExpr(c: Condition): string {
  if (c.kind === "and" || c.kind === "or") {
    if (c.conds.length === 0) return c.kind === "and" ? "and()" : "or()";
    return `${c.kind}(${c.conds.map(treeExpr).join(",")})`;
  }
  const name = c.col.name;
  switch (c.op) {
    case "is":
      return `${name}.is.null`;
    case "isnot":
      return `${name}.not.is.null`;
    case "in":
      return `${name}.in.(${(c.value as unknown[]).map(quote).join(",")})`;
    default:
      return `${name}.${c.op}.${quote(c.value)}`;
  }
}

// Minimal structural type for the supabase-js filter builder.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FilterBuilder = any;

function applyCondition(q: FilterBuilder, c: Condition | undefined): FilterBuilder {
  if (!c) return q;
  if (c.kind === "and") {
    for (const sub of c.conds) q = applyCondition(q, sub);
    return q;
  }
  if (c.kind === "or") {
    if (c.conds.length === 0) return q;
    if (c.conds.length === 1) return applyCondition(q, c.conds[0]);
    return q.or(c.conds.map(treeExpr).join(","));
  }
  const name = c.col.name;
  switch (c.op) {
    case "is":
      return q.is(name, null);
    case "isnot":
      return q.not(name, "is", null);
    case "in":
      return q.in(name, (c.value as unknown[]).map(toDb));
    case "like":
      return q.like(name, c.value as string);
    case "ilike":
      return q.ilike(name, c.value as string);
    default:
      return q.filter(name, c.op, toDb(c.value));
  }
}

// ---------------------------------------------------------------------------
// Result typing helpers
// ---------------------------------------------------------------------------

type Shape = Record<string, AnyColumn>;
type ColValue<C> = C extends { _: { data: infer D; notNull: infer N } } ? (N extends true ? D : D | null) : unknown;
export type ShapeResult<S extends Shape> = { [K in keyof S]: ColValue<S[K]> };

function selectList(shape: Shape | null): string {
  if (!shape) return "*";
  return Object.entries(shape)
    .map(([alias, col]) => (alias === col.name ? col.name : `${alias}:${col.name}`))
    .join(",");
}

function shapeRow(shape: Shape, raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [alias, col] of Object.entries(shape)) out[alias] = fromDb(col, raw[alias]);
  return out;
}

function mapRows(table: PgTable, shape: Shape | null, rows: Array<Record<string, unknown>>): unknown[] {
  const m = meta(table);
  return rows.map((r) => (shape ? shapeRow(shape, r) : rowFromDb(m, r)));
}

const PAGE = 1000;

// ---------------------------------------------------------------------------
// Undo log (transaction emulation)
// ---------------------------------------------------------------------------
//
// PostgREST requests are independent, so a multi-step operation can't share one
// database transaction. `db.transaction()` therefore records how to undo every
// write it makes; if the callback throws, the writes are reverted in reverse
// order before the error is re-thrown. This gives the same all-or-nothing
// outcome on failure (e.g. a duplicate invoice number half-way through a sale).

type UndoStep = () => Promise<void>;

class UndoLog {
  steps: UndoStep[] = [];
  push(step: UndoStep) {
    this.steps.push(step);
  }
  async rollback() {
    for (const step of this.steps.reverse()) {
      try {
        await step();
      } catch (err) {
        console.error(JSON.stringify({ level: "error", msg: "transaction rollback step failed", err: String(err) }));
      }
    }
    this.steps = [];
  }
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

class SelectQuery<R> implements PromiseLike<R[]> {
  private cond?: Condition;
  private orders: Order[] = [];
  private max?: number;

  constructor(private readonly table: PgTable, private readonly shape: Shape | null) {}

  where(cond?: Condition): this {
    this.cond = cond;
    return this;
  }
  orderBy(...orders: Array<Order | AnyColumn>): this {
    this.orders = orders.map((o) => ("col" in (o as Order) ? (o as Order) : { col: o as AnyColumn, ascending: true }));
    return this;
  }
  limit(n: number): this {
    this.max = n;
    return this;
  }

  async execute(): Promise<R[]> {
    const m = meta(this.table);
    const pkCol = m.columns[m.pk];
    const orders = [...this.orders];
    // Stable paging needs a total order; add the primary key as a tiebreaker.
    if (pkCol && !orders.some((o) => o.col === pkCol)) orders.push({ col: pkCol, ascending: true });

    const out: Array<Record<string, unknown>> = [];
    for (let offset = 0; ; offset += PAGE) {
      const want = this.max != null ? Math.min(PAGE, this.max - offset) : PAGE;
      if (want <= 0) break;
      let q: FilterBuilder = supabase().from(m.name).select(selectList(this.shape));
      q = applyCondition(q, this.cond);
      for (const o of orders) q = q.order(o.col.name, { ascending: o.ascending, nullsFirst: !o.ascending });
      q = q.range(offset, offset + want - 1);
      const rows = check(await q) as Array<Record<string, unknown>>;
      out.push(...rows);
      if (rows.length < want) break;
    }
    return mapRows(this.table, this.shape, out) as R[];
  }

  then<A = R[], B = never>(onfulfilled?: ((v: R[]) => A | PromiseLike<A>) | null, onrejected?: ((e: unknown) => B | PromiseLike<B>) | null): Promise<A | B> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

class InsertQuery<T extends PgTable, R = void> implements PromiseLike<R> {
  private rows: Array<Record<string, unknown>> = [];
  private shape: Shape | null = null;
  private wantReturn = false;
  private conflict?: { target: AnyColumn | AnyColumn[]; set: Record<string, unknown> };

  constructor(private readonly table: T, private readonly undo: UndoLog | null) {}

  values(v: T["$inferInsert"] | Array<T["$inferInsert"]>): this {
    this.rows = (Array.isArray(v) ? v : [v]) as Array<Record<string, unknown>>;
    return this;
  }
  returning(): InsertQuery<T, Array<T["$inferSelect"]>>;
  returning<S extends Shape>(shape: S): InsertQuery<T, Array<ShapeResult<S>>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  returning(shape?: Shape): any {
    this.wantReturn = true;
    this.shape = shape ?? null;
    return this;
  }
  onConflictDoUpdate(opts: { target: AnyColumn | AnyColumn[]; set: Partial<T["$inferInsert"]> }): this {
    this.conflict = opts as { target: AnyColumn | AnyColumn[]; set: Record<string, unknown> };
    return this;
  }

  async execute(): Promise<R> {
    const m = meta(this.table);
    if (this.rows.length === 0) return (this.wantReturn ? [] : undefined) as R;
    const payload = this.rows.map((r) => rowToDb(m, r));

    if (this.conflict) {
      // INSERT … ON CONFLICT (target) DO UPDATE SET … — insert, and on a
      // unique violation update the existing row with `set` instead.
      const results: Array<Record<string, unknown>> = [];
      const targets = Array.isArray(this.conflict.target) ? this.conflict.target : [this.conflict.target];
      for (const row of payload) {
        const ins = await supabase().from(m.name).insert(row).select("*");
        if (!ins.error) {
          results.push(...(ins.data as Array<Record<string, unknown>>));
          continue;
        }
        if (ins.error.code !== "23505") throw new DbError(ins.error);
        let q: FilterBuilder = supabase().from(m.name).update(rowToDb(m, this.conflict.set, { applyOnUpdate: true }));
        for (const t of targets) q = q.eq(t.name, row[t.name]);
        results.push(...(check(await q.select("*")) as Array<Record<string, unknown>>));
      }
      return this.finish(m, results);
    }

    const res = await supabase().from(m.name).insert(payload).select("*");
    const rows = check(res) as Array<Record<string, unknown>>;
    if (this.undo) {
      const pkName = m.columns[m.pk]!.name;
      const ids = rows.map((r) => r[pkName]);
      this.undo.push(async () => {
        check(await supabase().from(m.name).delete().in(pkName, ids));
      });
    }
    return this.finish(m, rows);
  }

  private finish(m: TableMeta, rows: Array<Record<string, unknown>>): R {
    if (!this.wantReturn) return undefined as R;
    const mapped = rows.map((r) => rowFromDb(m, r));
    return (this.shape ? mapped.map((r) => reshape(this.shape!, r, m)) : mapped) as R;
  }

  then<A = R, B = never>(onfulfilled?: ((v: R) => A | PromiseLike<A>) | null, onrejected?: ((e: unknown) => B | PromiseLike<B>) | null): Promise<A | B> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

// shapeRow over an already-converted row (keys are camelCase there).
function reshape(shape: Shape, row: Record<string, unknown>, m: TableMeta): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [alias, col] of Object.entries(shape)) out[alias] = row[m.byDbName[col.name] ?? col.name];
  return out;
}

class UpdateQuery<T extends PgTable, R = void> implements PromiseLike<R> {
  private values: Record<string, unknown> = {};
  private cond?: Condition;
  private shape: Shape | null = null;
  private wantReturn = false;

  constructor(private readonly table: T, private readonly undo: UndoLog | null) {}

  set(values: Partial<T["$inferInsert"]> | Record<string, unknown>): this {
    this.values = values as Record<string, unknown>;
    return this;
  }
  where(cond?: Condition): this {
    this.cond = cond;
    return this;
  }
  returning(): UpdateQuery<T, Array<T["$inferSelect"]>>;
  returning<S extends Shape>(shape: S): UpdateQuery<T, Array<ShapeResult<S>>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  returning(shape?: Shape): any {
    this.wantReturn = true;
    this.shape = shape ?? null;
    return this;
  }

  async execute(): Promise<R> {
    const m = meta(this.table);
    const pkName = m.columns[m.pk]!.name;

    if (this.undo) {
      // Snapshot the rows we're about to change so they can be restored.
      let snap: FilterBuilder = supabase().from(m.name).select("*");
      snap = applyCondition(snap, this.cond);
      const before = check(await snap) as Array<Record<string, unknown>>;
      if (before.length) {
        this.undo.push(async () => {
          for (const row of before) {
            const { [pkName]: id, ...rest } = row;
            check(await supabase().from(m.name).update(rest).eq(pkName, id));
          }
        });
      }
    }

    let q: FilterBuilder = supabase().from(m.name).update(rowToDb(m, this.values, { applyOnUpdate: true }));
    q = applyCondition(q, this.cond);
    const rows = check(await q.select("*")) as Array<Record<string, unknown>>;
    if (!this.wantReturn) return undefined as R;
    const mapped = rows.map((r) => rowFromDb(m, r));
    return (this.shape ? mapped.map((r) => reshape(this.shape!, r, m)) : mapped) as R;
  }

  then<A = R, B = never>(onfulfilled?: ((v: R) => A | PromiseLike<A>) | null, onrejected?: ((e: unknown) => B | PromiseLike<B>) | null): Promise<A | B> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

class DeleteQuery<T extends PgTable, R = void> implements PromiseLike<R> {
  private cond?: Condition;
  private shape: Shape | null = null;
  private wantReturn = false;

  constructor(private readonly table: T, private readonly undo: UndoLog | null) {}

  where(cond?: Condition): this {
    this.cond = cond;
    return this;
  }
  returning(): DeleteQuery<T, Array<T["$inferSelect"]>>;
  returning<S extends Shape>(shape: S): DeleteQuery<T, Array<ShapeResult<S>>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  returning(shape?: Shape): any {
    this.wantReturn = true;
    this.shape = shape ?? null;
    return this;
  }

  async execute(): Promise<R> {
    const m = meta(this.table);
    if (!this.cond) throw new Error(`Refusing to delete every row of ${m.name} (no where clause)`);
    let q: FilterBuilder = supabase().from(m.name).delete();
    q = applyCondition(q, this.cond);
    const rows = check(await q.select("*")) as Array<Record<string, unknown>>;
    if (this.undo && rows.length) {
      this.undo.push(async () => {
        check(await supabase().from(m.name).insert(rows));
      });
    }
    if (!this.wantReturn) return undefined as R;
    const mapped = rows.map((r) => rowFromDb(m, r));
    return (this.shape ? mapped.map((r) => reshape(this.shape!, r, m)) : mapped) as R;
  }

  then<A = R, B = never>(onfulfilled?: ((v: R) => A | PromiseLike<A>) | null, onrejected?: ((e: unknown) => B | PromiseLike<B>) | null): Promise<A | B> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

// ---------------------------------------------------------------------------
// Database facade
// ---------------------------------------------------------------------------

export class Database {
  constructor(private readonly undo: UndoLog | null = null) {}

  select(): { from<T extends PgTable>(table: T): SelectQuery<T["$inferSelect"]> };
  select<S extends Shape>(shape: S): { from(table: PgTable): SelectQuery<ShapeResult<S>> };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  select(shape?: Shape): any {
    return {
      from: (table: PgTable) => {
        // A projection may name columns of this table only (no joins).
        if (shape) {
          for (const col of Object.values(shape)) {
            if (columnTable(col) !== table) {
              throw new Error(`select(): column ${col.name} is not on table ${getTableName(table)}`);
            }
          }
        }
        return new SelectQuery(table, shape ?? null);
      },
    };
  }

  insert<T extends PgTable>(table: T): InsertQuery<T> {
    return new InsertQuery(table, this.undo);
  }

  update<T extends PgTable>(table: T): UpdateQuery<T> {
    return new UpdateQuery(table, this.undo);
  }

  delete<T extends PgTable>(table: T): DeleteQuery<T> {
    return new DeleteQuery(table, this.undo);
  }

  /** All-or-nothing multi-step write (see UndoLog above). */
  async transaction<T>(fn: (tx: Database) => Promise<T>): Promise<T> {
    if (this.undo) return fn(this); // nested: share the outer log
    const log = new UndoLog();
    try {
      return await fn(new Database(log));
    } catch (err) {
      await log.rollback();
      throw err;
    }
  }

  /** Lightweight connectivity check used by diagnostics. */
  async ping(): Promise<{ ok: true }> {
    check(await supabase().from("system_state").select("key").limit(1));
    return { ok: true };
  }
}

export const db = new Database();
