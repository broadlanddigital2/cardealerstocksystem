/**
 * Tests for the Supabase (PostgREST) data layer that replaced the direct
 * Postgres connection: query translation, Drizzle-compatible row shapes,
 * unique-violation errors, and transaction rollback via the undo log.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { table: string; method: string; args: unknown[] };
const calls: Call[] = [];
let responder: (table: string, chain: Call[]) => { data: unknown; error: unknown } = () => ({ data: [], error: null });

function makeQuery(table: string) {
  const chain: Call[] = [];
  const q: Record<string, unknown> = {};
  const record = (method: string) => (...args: unknown[]) => {
    const c = { table, method, args };
    chain.push(c);
    calls.push(c);
    return q;
  };
  for (const m of ["select", "insert", "update", "delete", "filter", "eq", "or", "is", "not", "in", "like", "ilike", "order", "range", "limit"]) {
    q[m] = record(m);
  }
  q.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
    try {
      return Promise.resolve(resolve(responder(table, chain)));
    } catch (e) {
      return Promise.resolve(reject(e));
    }
  };
  return q;
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: (table: string) => makeQuery(table) }),
}));

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";

const dbmod = await import("@workspace/db");
const { db, vehiclesTable, invoicesTable, eq, and, ne, or, desc, equalsIgnoreCase, containsIgnoreCase, DbError } = dbmod;

beforeEach(() => {
  calls.length = 0;
  responder = () => ({ data: [], error: null });
});

describe("select", () => {
  it("translates conditions, ordering and limit to PostgREST calls", async () => {
    await db
      .select()
      .from(vehiclesTable)
      .where(
        and(
          eq(vehiclesTable.userId, "tenant"),
          ne(vehiclesTable.status, "sold"),
          equalsIgnoreCase(vehiclesTable.registrationNumber, "AB12_CDE"),
          or(containsIgnoreCase(vehiclesTable.make, "Ford, Ka"), containsIgnoreCase(vehiclesTable.model, "x")),
        ),
      )
      .orderBy(desc(vehiclesTable.createdAt))
      .limit(1);

    const byMethod = (m: string) => calls.filter((c) => c.method === m).map((c) => c.args);
    expect(calls[0]).toMatchObject({ table: "vehicles", method: "select", args: ["*"] });
    expect(byMethod("filter")).toEqual([
      ["user_id", "eq", "tenant"],
      ["status", "neq", "sold"],
    ]);
    // Case-insensitive equality escapes LIKE wildcards.
    expect(byMethod("ilike")).toEqual([["registration_number", "AB12\\_CDE"]]);
    // Values with reserved characters are quoted inside or=(…).
    expect(byMethod("or")).toEqual([['make.ilike."%Ford, Ka%",model.ilike.%x%']]);
    expect(byMethod("order")[0]).toEqual(["created_at", { ascending: false, nullsFirst: true }]);
    expect(byMethod("range")).toEqual([[0, 0]]);
  });

  it("returns Drizzle-shaped rows (camelCase, numeric strings, Date timestamps)", async () => {
    responder = () => ({
      data: [{ id: 7, user_id: "t", purchase_price: 1234.5, created_at: "2026-10-10T10:00:00Z", photo_urls: ["/objects/uploads/x"] }],
      error: null,
    });
    const [row] = await db.select().from(vehiclesTable);
    expect(row.id).toBe(7);
    expect(row.userId).toBe("t");
    expect(row.purchasePrice).toBe("1234.5");
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.photoUrls).toEqual(["/objects/uploads/x"]);
  });

  it("supports column projections with aliases", async () => {
    responder = () => ({ data: [{ vehicleId: 3 }], error: null });
    const rows = await db.select({ vehicleId: invoicesTable.vehicleId }).from(invoicesTable);
    expect(calls[0]!.args).toEqual(["vehicleId:vehicle_id"]);
    expect(rows).toEqual([{ vehicleId: 3 }]);
  });

  it("pages through more than 1000 rows", async () => {
    let page = 0;
    responder = (_t, chain) => {
      const range = chain.find((c) => c.method === "range")!.args as [number, number];
      page++;
      const size = page === 1 ? range[1] - range[0] + 1 : 5;
      return { data: Array.from({ length: size }, (_, i) => ({ id: range[0] + i })), error: null };
    };
    const rows = await db.select({ id: vehiclesTable.id }).from(vehiclesTable);
    expect(rows).toHaveLength(1005);
  });
});

describe("writes", () => {
  it("maps values to snake_case and sets updated_at on update", async () => {
    responder = () => ({ data: [{ id: 1, sale_price: "100" }], error: null });
    const [row] = await db
      .update(vehiclesTable)
      .set({ salePrice: "100", buyerName: undefined })
      .where(eq(vehiclesTable.id, 1))
      .returning();
    const update = calls.find((c) => c.method === "update")!.args[0] as Record<string, unknown>;
    expect(update.sale_price).toBe("100");
    expect("buyer_name" in update).toBe(false);
    expect(typeof update.updated_at).toBe("string");
    expect(row.salePrice).toBe("100");
  });

  it("raises unique violations with pg-style code and constraint", async () => {
    responder = () => ({
      data: null,
      error: { code: "23505", message: 'duplicate key value violates unique constraint "invoices_user_invoice_number_idx"' },
    });
    const err = await db
      .insert(invoicesTable)
      .values({ userId: "t", vehicleId: 1, invoiceNumber: "1", invoiceDate: "2026-01-01", customerName: "a", customerAddress: "b", salePrice: "1", balancePayable: "1" })
      .then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(DbError);
    expect((err as InstanceType<typeof DbError>).code).toBe("23505");
    expect((err as InstanceType<typeof DbError>).constraint).toBe("invoices_user_invoice_number_idx");
  });
});

describe("transaction", () => {
  it("reverts earlier writes when a later step fails", async () => {
    const before = { id: 5, user_id: "t", status: "in_stock" };
    responder = (table, chain) => {
      const methods = chain.map((c) => c.method);
      if (table === "vehicles" && methods[0] === "select") return { data: [before], error: null }; // snapshot
      if (table === "vehicles" && methods[0] === "update") return { data: [{ ...before, status: "sold" }], error: null };
      if (table === "invoices" && methods[0] === "insert") {
        return { data: null, error: { code: "23505", message: 'unique constraint "invoices_user_invoice_number_idx"' } };
      }
      return { data: [], error: null };
    };

    await expect(
      db.transaction(async (tx) => {
        await tx.update(vehiclesTable).set({ status: "sold" }).where(eq(vehiclesTable.id, 5));
        await tx.insert(invoicesTable).values({ userId: "t", vehicleId: 5, invoiceNumber: "1", invoiceDate: "2026-01-01", customerName: "a", customerAddress: "b", salePrice: "1", balancePayable: "1" });
      }),
    ).rejects.toBeInstanceOf(DbError);

    const updates = calls.filter((c) => c.table === "vehicles" && c.method === "update").map((c) => c.args[0] as Record<string, unknown>);
    // The forward update, then the restore of the original row.
    expect(updates).toHaveLength(2);
    expect(updates[1]).toMatchObject({ status: "in_stock", user_id: "t" });
  });
});
