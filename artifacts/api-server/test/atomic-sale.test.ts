// Real PostgreSQL integration coverage. All rows belong to a unique test-only
// tenant and are removed after each test; never touches dealership stock.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, pool, vehiclesTable, invoicesTable, invoiceArchiveTable } from "@workspace/db";
import { assertInvoiceNumberAvailable, nextInvoiceNumber, lockInvoiceNumbers } from "../src/lib/invoiceNumbers";
import { RecordSaleBody, GetVehicleResponse } from "@workspace/api-zod";

const auth = vi.hoisted(() => ({ tenant: "" }));
vi.mock("../src/middlewares/requireAuth", () => ({
  getSessionUserId: () => "test-admin",
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.userId = auth.tenant;
    next();
  },
}));
vi.mock("../src/lib/objectStorage", () => ({ ObjectStorageService: class {} }));
import vehicleRouter from "../src/routes/vehicles";

describe("atomic sale (PostgreSQL)", () => {
  let server: Server;
  let baseUrl: string;
  let vehicleId: number;
  const input = {
    saleDate: "2026-10-20", salesInvoiceNumber: "INV-0001",
    buyerName: "Atomic sale test", buyerAddress: "Test address",
    salePrice: 5495, saleVat: 1099, holdingDeposit: 100,
    partExchangeAllowance: 9000, partExchangeMake: "Test",
    partExchangeModel: "PX", partExchangeRegistration: "ATOMIC-PX",
    financeCompanyName: "Test finance", financeCompanyAddress: "Finance address",
    financeCompanyEmail: "finance@example.invalid", saleNotes: "Invoice notes",
    extras: [
      { description: "Financed", amount: 100, vat: 20, onFinanceInvoice: true },
      { description: "Separate", amount: 50, vat: 10, onFinanceInvoice: false },
    ],
  };

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use(vehicleRouter);
    app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: "Write failed" });
    });
    server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  beforeEach(async () => {
    auth.tenant = `atomic-sale-test-${randomUUID()}`;
    const [vehicle] = await db.insert(vehiclesTable).values({
      userId: auth.tenant, stockNumber: "TEST00001", purchaseNumber: "PUR00001",
      registrationNumber: "ATOMIC-CAR", make: "Test", model: "Car",
      purchaseDate: "2026-10-01", purchaseType: "private", sellerName: "Test seller",
      purchasePrice: "4000", vatQualifying: true,
      status: "reserved", holdingDepositAmount: "100",
    }).returning();
    vehicleId = vehicle.id;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await db.delete(invoicesTable).where(eq(invoicesTable.userId, auth.tenant));
    await db.delete(vehiclesTable).where(eq(vehiclesTable.userId, auth.tenant));
    // Retained audit snapshots are not deleted, even by test cleanup.
  });
  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    await pool.end();
  });
  async function post(overrides: object = {}) {
    return fetch(`${baseUrl}/vehicles/${vehicleId}/sale`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, ...overrides }),
    });
  }
  it("archives the highest invoice on deletion and allocates beyond it", async () => {
    expect((await post()).status).toBe(200);
    const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.vehicleId, vehicleId));
    const response = await fetch(`${baseUrl}/vehicles/${vehicleId}`, { method: "DELETE" });
    expect(response.status).toBe(204);
    const [archive] = await db.select().from(invoiceArchiveTable).where(eq(invoiceArchiveTable.userId, auth.tenant));
    expect(archive.invoiceNumber).toBe(invoice.invoiceNumber);
    expect(archive.invoiceSnapshot).toEqual(JSON.parse(JSON.stringify(invoice)));
    expect(archive.vehicleSnapshot).toMatchObject({ id: vehicleId, status: "sold", buyerName: input.buyerName });
    expect(await db.select().from(invoicesTable).where(eq(invoicesTable.vehicleId, vehicleId))).toHaveLength(0);
    expect(await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, vehicleId))).toHaveLength(0);
    await db.transaction(async tx => {
      await lockInvoiceNumbers(tx, auth.tenant);
      expect(await nextInvoiceNumber(tx, auth.tenant)).toBe("INV-0002");
      await expect(assertInvoiceNumberAvailable(tx, auth.tenant, vehicleId, invoice.invoiceNumber)).rejects.toThrow("already linked");
      expect(await nextInvoiceNumber(tx, `${auth.tenant}-other`)).toBe("INV-0001");
    });
    expect((await fetch(`${baseUrl}/vehicles/${vehicleId}`, { method: "DELETE" })).status).toBe(404);
    expect(await db.select().from(invoiceArchiveTable).where(eq(invoiceArchiveTable.userId, auth.tenant))).toHaveLength(1);
  });

  it("reserves an incomplete sale reference even without an invoice", async () => {
    await db.update(vehiclesTable).set({ salesInvoiceNumber: "LEGACY-0099" }).where(eq(vehiclesTable.id, vehicleId));
    expect((await fetch(`${baseUrl}/vehicles/${vehicleId}`, { method: "DELETE" })).status).toBe(204);
    const [archive] = await db.select().from(invoiceArchiveTable).where(eq(invoiceArchiveTable.userId, auth.tenant));
    expect(archive.invoiceSnapshot).toBeNull();
    expect(await nextInvoiceNumber(db, auth.tenant)).toBe("INV-0100");
  });

  it("preserves mismatched historical sale and invoice references separately", async () => {
    expect((await post()).status).toBe(200);
    await db.update(vehiclesTable).set({ salesInvoiceNumber: "OLD-0200" }).where(eq(vehiclesTable.id, vehicleId));
    expect((await fetch(`${baseUrl}/vehicles/${vehicleId}`, { method: "DELETE" })).status).toBe(204);
    const archives = await db.select().from(invoiceArchiveTable).where(eq(invoiceArchiveTable.userId, auth.tenant));
    expect(archives.map(a => a.invoiceNumber).sort()).toEqual(["INV-0001", "OLD-0200"]);
    expect(await nextInvoiceNumber(db, auth.tenant)).toBe("INV-0201");
  });

  it("does not delete or archive another dealer's vehicle", async () => {
    const owner = auth.tenant;
    auth.tenant = `${owner}-other`;
    try {
      expect((await fetch(`${baseUrl}/vehicles/${vehicleId}`, { method: "DELETE" })).status).toBe(404);
    } finally { auth.tenant = owner; }
    expect(await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, vehicleId))).toHaveLength(1);
    expect(await db.select().from(invoiceArchiveTable).where(eq(invoiceArchiveTable.userId, owner))).toHaveLength(0);
  });

  it("rolls back archival and deletion together if the final delete fails", async () => {
    expect((await post()).status).toBe(200);
    const realTransaction = db.transaction.bind(db);
    vi.spyOn(db, "transaction").mockImplementationOnce((async (callback: any) =>
      realTransaction(async tx => {
        const realDelete = tx.delete.bind(tx);
        vi.spyOn(tx, "delete").mockImplementation(((table: any) => {
          if (table === vehiclesTable) throw new Error("Simulated delete failure");
          return realDelete(table);
        }) as any);
        return callback(tx);
      })) as typeof db.transaction);
    expect((await fetch(`${baseUrl}/vehicles/${vehicleId}`, { method: "DELETE" })).status).toBe(500);
    expect(await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, vehicleId))).toHaveLength(1);
    expect(await db.select().from(invoicesTable).where(eq(invoicesTable.vehicleId, vehicleId))).toHaveLength(1);
    expect(await db.select().from(invoiceArchiveTable).where(eq(invoiceArchiveTable.userId, auth.tenant))).toHaveLength(0);
  });
  async function state() {
    return {
      vehicles: await db.select().from(vehiclesTable).where(eq(vehiclesTable.userId, auth.tenant)),
      invoices: await db.select().from(invoicesTable).where(eq(invoicesTable.userId, auth.tenant)),
    };
  }

  async function snapshot() {
    const response = await fetch(`${baseUrl}/vehicles/${vehicleId}`);
    expect(response.status).toBe(200);
    return GetVehicleResponse.parse(await response.json());
  }
  async function expectUnchanged() {
    const rows = await state();
    expect(rows.vehicles).toHaveLength(1);
    expect(rows.vehicles[0]).toMatchObject({ status: "reserved", salePrice: null, partExchangeVehicleId: null });
    expect(rows.invoices).toHaveLength(0);
  }
  async function stageSaleAndPatchStatus() {
    await db.update(vehiclesTable).set({
      saleDate: input.saleDate, buyerName: input.buyerName, buyerAddress: input.buyerAddress,
      salePrice: String(input.salePrice), saleVat: String(input.saleVat),
      partExchangeAllowance: String(input.partExchangeAllowance),
      partExchangeMake: input.partExchangeMake, partExchangeModel: input.partExchangeModel,
      partExchangeRegistration: input.partExchangeRegistration,
    }).where(eq(vehiclesTable.id, vehicleId));
    return fetch(`${baseUrl}/vehicles/${vehicleId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "sold" }),
    });
  }
  it("creates invoice and linked PX for a status-only transition using staged sale details", async () => {
    const response = await stageSaleAndPatchStatus();
    expect(response.status).toBe(200);
    const rows = await state();

    const vehicle = rows.vehicles.find(v => v.id === vehicleId)!;
    expect(rows.vehicles).toHaveLength(2);
    expect(rows.invoices).toHaveLength(1);
    expect(rows.invoices.find(i => i.vehicleId === vehicleId)?.invoiceNumber).toBe("INV-0001");
  });
  it("rolls back sale and PX on a real database invoice constraint failure", async () => {
    const transaction = db.transaction.bind(db);
    vi.spyOn(db, "transaction").mockImplementation((callback, config) =>
      transaction(async tx => {
        const insert = tx.insert.bind(tx);
        vi.spyOn(tx, "insert").mockImplementation(((table: unknown) => {
          if (table === invoicesTable) throw new Error("Injected invoice failure");
          return insert(table as typeof vehiclesTable);
        }) as typeof tx.insert);
        return callback(tx);
      }, config));
    expect((await stageSaleAndPatchStatus()).status).toBe(500);
    const rows = await state();

    const vehicle = rows.vehicles.find(v => v.id === vehicleId)!;
    expect(rows.vehicles).toHaveLength(1);
    expect(rows.vehicles[0]).toMatchObject({ status: "reserved", salesInvoiceNumber: null, partExchangeVehicleId: null });
    expect(rows.invoices).toHaveLength(0);
  });
  it("commits sale, PX, full finance details and extras with a negative balance", async () => {
    const response = await post();
    expect(response.status).toBe(200);
    const rows = await state();

    const vehicle = rows.vehicles.find(v => v.id === vehicleId)!;
    expect(rows.vehicles).toHaveLength(2);
    expect(rows.invoices).toHaveLength(1);
    expect(rows.invoices[0]).toMatchObject({ invoiceNumber: "INV-0001", financeCompanyName: input.financeCompanyName, balancePayable: "-2386" });
  });
  it("rolls back sale and PX on a real database invoice constraint failure", async () => {
    const transaction = db.transaction.bind(db);
    vi.spyOn(db, "transaction").mockImplementation((callback, config) =>
      transaction(async tx => {
        const insert = tx.insert.bind(tx);
        vi.spyOn(tx, "insert").mockImplementation(((table: unknown) => {
          if (table === invoicesTable) throw new Error("Injected invoice failure");
          return insert(table as typeof vehiclesTable);
        }) as typeof tx.insert);
        return callback(tx);
      }, config));
    expect((await post()).status).toBe(500);
    await expectUnchanged();
  });
  it("allocates past an existing invoice rather than trusting a stale client number", async () => {
    await db.insert(invoicesTable).values({
      userId: auth.tenant, vehicleId: -1, invoiceNumber: input.salesInvoiceNumber,
      invoiceDate: input.saleDate, customerName: "Existing", customerAddress: "Test",
      salePrice: "1", balancePayable: "1",
    });
    const response = await post({
      holdingDeposit: undefined, extras: undefined,
      financeCompanyName: undefined, financeCompanyAddress: undefined, financeCompanyEmail: undefined,
    });
    expect(response.status).toBe(200);
    const rows = await state();

    const vehicle = rows.vehicles.find(v => v.id === vehicleId)!;
    expect(rows.vehicles).toHaveLength(2);
    expect(rows.invoices).toHaveLength(2);
    expect(rows.invoices.find(i => i.vehicleId === vehicleId)?.invoiceNumber).toBe("INV-0002");
  });
  it("rolls back sale and PX on a real database invoice constraint failure", async () => {
    const transaction = db.transaction.bind(db);
    vi.spyOn(db, "transaction").mockImplementation((callback, config) =>
      transaction(async tx => {
        const insert = tx.insert.bind(tx);
        vi.spyOn(tx, "insert").mockImplementation(((table: unknown) => {
          if (table === invoicesTable) return {
            values: (values: typeof invoicesTable.$inferInsert) => ({ returning: async () => {
              // Force the database backstop to reject the actual invoice write.
              await insert(invoicesTable).values({ ...values, vehicleId: -1 });
              return insert(invoicesTable).values(values).returning();
            } }),
          };
          return insert(table as typeof vehiclesTable);
        }) as typeof tx.insert);
        return callback(tx);
      }, config));
    expect((await post()).status).toBe(409);
    await expectUnchanged();
  });
  it("safely retries after the client loses a successful response", async () => {
    const lostResponse = await post();
    await lostResponse.body?.cancel(); // committed response discarded by the caller
    const before = await state();
    const retry = await post();
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ id: vehicleId, status: "sold", hasInvoice: true });
    expect(await state()).toEqual(before);
  });
  it("accepts unchanged retries with no client invoice number", async () => {
    expect((await post({ salesInvoiceNumber: undefined })).status).toBe(200);
    const before = await state();
    expect((await post({ salesInvoiceNumber: undefined })).status).toBe(200);
    expect(await state()).toEqual(before);
  });
  it("serializes simultaneous identical submissions without duplicate PX or invoice", async () => {
    const responses = await Promise.all([post(), post()]);
    expect(responses.map(r => r.status)).toEqual([200, 200]);
    const rows = await state();

    const vehicle = rows.vehicles.find(v => v.id === vehicleId)!;
    expect(rows.vehicles).toHaveLength(2);
    expect(rows.invoices).toHaveLength(1);
  });
  it("rejects a changed replay without changing saved records", async () => {
    expect((await post()).status).toBe(200);
    const before = await state();
    expect((await post({ financeCompanyName: "Different finance" })).status).toBe(409);
    expect(await state()).toEqual(before);
  });
  it("rejects stale deposits and invalid extras before any writes", async () => {
    expect((await post({ holdingDeposit: 99 })).status).toBe(409);
    await expectUnchanged();
    expect((await post({ extras: [{ description: "Invalid", amount: -1 }] })).status).toBe(400);
    await expectUnchanged();
  });
  it("supports legacy callers without invoice-only fields and ignores VAT on margin vehicles", async () => {
    await db.update(vehiclesTable).set({ vatQualifying: false }).where(and(
      eq(vehiclesTable.id, vehicleId), eq(vehiclesTable.userId, auth.tenant),
    ));
    const response = await post({
      holdingDeposit: undefined, extras: undefined,
      financeCompanyName: undefined, financeCompanyAddress: undefined, financeCompanyEmail: undefined,
    });
    expect(response.status).toBe(200);
    const rows = await state();

    const vehicle = rows.vehicles.find(v => v.id === vehicleId)!;
    expect(rows.invoices[0]).toMatchObject({ balancePayable: "-3605", saleVat: null, holdingDeposit: "100" });
    expect(RecordSaleBody.safeParse(input).success).toBe(true);
  });
});
