import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import type { Request, Response, NextFunction } from "../http";
import { startTestServer, type TestServer } from "./helpers/server";
import { eq } from "@workspace/db";
import { db, vehiclesTable, issuedSalesTable, saleCreditsTable, saleRefundsTable, depositRefundsTable } from "@workspace/db";
import { computeDashboardSummary, buildJournalRows } from "@workspace/report-calc";
import { accountingSources, saleReportRows, validDate, validMoney } from "../lib/saleLedger";
import { GetCancellationStateResponse, GetSalesReportResponse, ListAccountingHistoryResponse, GetVehicleResponse, GetInvoiceResponse } from "@workspace/api-zod";
import { ConfirmSaleRefundResponse, GetVehicleSaleHistoryResponse } from "@workspace/api-zod";

// Server database tests use the standard Postgres driver (CI's Postgres service).
const testDb = vi.hoisted(() => ({ pool: undefined as undefined | { end(): Promise<void> } }));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const { createTestDb } = await import("@workspace/db/testing");
  const t = createTestDb(process.env.TEST_DATABASE_URL ?? "postgres://skip@127.0.0.1:1/skip");
  testDb.pool = t.pool;
  return { ...actual, db: t.db };
});
const auth = vi.hoisted(() => ({ tenant: "", admin: true }));
vi.mock("../middlewares/requireAuth", () => ({
  getSessionUserId: () => "test-confirming-admin",
  // Reports routes check the user's modules (role lookup): the test user is an admin.
  getUserEmail: async () => "test-confirming-admin",
  getEmailRole: async () => "admin",
  requireAuth: (req: Request, _res: Response, next: NextFunction) => { req.userId = auth.tenant; next(); },
  requireAdmin: (req: Request, res: Response, next: NextFunction) => {
    if (!auth.admin) { res.status(403).json({ error: "forbidden" }); return; }
    req.userId = auth.tenant; next();
  },
}));
import vehiclesRouter from "../routes/vehicles";
import invoiceRouter from "../routes/invoices";
import creditsRouter from "../routes/saleCredits";
import reviewRouter from "../routes/legacySaleReview";
import reportsRouter from "../routes/reports";

// Dedicated random test tenants. Retained accounting records are deliberately
// NOT deleted by cleanup: tests exercise the same permanent retention boundary.
describe.skipIf(!process.env.TEST_DATABASE_URL)("permanent full credits and external refunds (PostgreSQL)", () => {
  let server: TestServer;
  let base: string;
  let id: number;
  const sale = { saleDate: "2025-09-15", buyerName: "Test buyer", buyerAddress: "Test address", salePrice: 1600, holdingDeposit: 100, payments: [{ date: "2025-09-15", amount: 200, paymentMethod: "bank", type: "payment" }], extras: [{ description: "Fee", amount: 100, vat: 20 }] };
  const approval = { cancellationDate: "2025-10-15", reason: "Full sale cancelled", receivedAmount: 300, reconciliation: "Bank receipts 200 plus deposit 100; remaining 1420 unpaid, no lender or PX.", receiptsConfirmed: true };
  const request = (path: string, method = "GET", body?: object) => fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  async function newVehicle(stock = "TEST1") {
    const [v] = await db.insert(vehiclesTable).values({
      userId: auth.tenant, stockNumber: stock, purchaseNumber: `PUR-${stock}`,
      registrationNumber: "CREDIT-TEST", make: "Test", model: "Car", purchaseDate: "2025-08-01",
      purchaseType: "private", sellerName: "Test seller", purchasePrice: "1000",
      holdingDepositAmount: "100", status: "reserved",
    }).returning();
    return v.id;
  }
  async function issue(overrides: object = {}) {
    const result = await request(`/vehicles/${id}/sale`, "POST", { ...sale, ...overrides });
    expect(result.status).toBe(200);
  }
  async function cancel(overrides: object = {}) {
    return request(`/vehicles/${id}/cancellation`, "POST", { ...approval, ...overrides });
  }
  beforeAll(async () => {
    server = await startTestServer([reviewRouter, creditsRouter, vehiclesRouter, invoiceRouter, reportsRouter]);
    base = server.base;
  });
  beforeEach(async () => { auth.tenant = `credit-regression-${randomUUID()}`; auth.admin = true; id = await newVehicle(); });
  afterAll(async () => { await server.close(); await testDb.pool?.end(); });

  it("requires explicit document review, rejects stale approvals and permanently retains legacy review evidence", async () => {
    await issue();
    // Only this random test tenant: simulate a sale created before snapshots.
    await db.delete(issuedSalesTable).where(eq(issuedSalesTable.userId, auth.tenant));
    const path = `/vehicles/${id}/accounting-review`;
    const getVersion = async () => GetVehicleResponse.parse(await (await request(`/vehicles/${id}`)).json()).editVersion!;
    const evidence = { documentReference: "Original sales and purchase invoices", notes: "Checked all dates, prices, margin scheme, extras and receipts.", confirmed: true, expectedEditVersion: await getVersion() };
    expect((await cancel()).status).toBe(409);
    auth.admin = false;
    expect((await request(path, "POST", evidence)).status).toBe(403);
    auth.admin = true;
    expect((await request(path, "POST", { ...evidence, confirmed: false })).status).toBe(400);
    expect((await request(path, "POST", { ...evidence, documentReference: " " })).status).toBe(400);
    await db.update(vehiclesTable).set({ description: "Changed during review" }).where(eq(vehiclesTable.id, id));
    expect((await request(path, "POST", evidence)).status).toBe(409);
    evidence.expectedEditVersion = await getVersion();
    const results = await Promise.all([request(path, "POST", evidence), request(path, "POST", evidence)]);
    expect(results.map(r => r.status)).toEqual([200, 200]);
    const issued = await db.select().from(issuedSalesTable).where(eq(issuedSalesTable.userId, auth.tenant));
    expect(issued).toHaveLength(1);
    expect(issued[0].reviewEvidence).toMatchObject({ documentReference: evidence.documentReference, notes: evidence.notes });
    expect(issued[0].actor).toBe("test-confirming-admin");
    expect((await request(path, "POST", { ...evidence, notes: "Changed evidence" })).status).toBe(409);
    expect((await cancel()).status).toBe(200);
    const history = ListAccountingHistoryResponse.parse(await (await request("/accounting-history")).json());
    expect(history.filter(r => r.type === "review")).toHaveLength(1);
    const timeline = GetVehicleSaleHistoryResponse.parse(await (await request(`/vehicles/${id}/sale-history`)).json());
    expect(timeline.some(r => r.type === "review")).toBe(true);
    expect((await request(`/vehicles/${id}`, "DELETE")).status).toBe(204);
    const retained = ListAccountingHistoryResponse.parse(await (await request("/accounting-history")).json()).find(r => r.type === "review")!;
    expect(JSON.parse(retained.originalDocument).review.documentReference).toBe(evidence.documentReference);
  });
  it("accepts approval and a refund reason without document-reference fields", async () => {
    await issue();
    await db.delete(issuedSalesTable).where(eq(issuedSalesTable.userId, auth.tenant));
    const data = { expectedEditVersion: GetVehicleResponse.parse(await (await request(`/vehicles/${id}`)).json()).editVersion,
      confirmed: true, refundReason: "Vehicle faulty" };
    const path = `/vehicles/${id}/accounting-review`;
    expect((await request(path, "POST", { ...data, refundReason: " " })).status).toBe(400);
    expect((await request(path, "POST", { ...data, confirmed: false })).status).toBe(400);
    expect((await request(path, "POST", data)).status).toBe(200);
    expect((await request(path, "POST", data)).status).toBe(200);
    const history = ListAccountingHistoryResponse.parse(await (await request("/accounting-history")).json());
    expect(history.find(r => r.type === "review")?.reconciliation).toBe("Refund reason: Vehicle faulty");
  });
  it("does not approve missing invoices, uncompleted sales or inconsistent saved figures", async () => {
    const path = `/vehicles/${id}/accounting-review`;
    const review = async () => request(path, "POST", {
      expectedEditVersion: GetVehicleResponse.parse(await (await request(`/vehicles/${id}`)).json()).editVersion,
      documentReference: "Test evidence", notes: "Originals checked", confirmed: true,
    });
    expect((await review()).status).toBe(409);
    await issue();
    await db.delete(issuedSalesTable).where(eq(issuedSalesTable.userId, auth.tenant));
    await db.update(vehiclesTable).set({ salePrice: "9999" }).where(eq(vehiclesTable.id, id));
    expect((await review()).status).toBe(409);
    expect(await db.select().from(issuedSalesTable).where(eq(issuedSalesTable.userId, auth.tenant))).toHaveLength(0);
  });
  it("requires admin approval and blocks unverifiable legacy data", async () => {
    expect((await cancel()).status).toBe(409);
    expect(GetCancellationStateResponse.parse(await (await request(`/vehicles/${id}/cancellation`)).json()).message).toContain("review");
    await issue();
    auth.admin = false;
    expect((await cancel()).status).toBe(403);
    expect((await request("/accounting-history")).status).toBe(403);
    expect((await request(`/vehicles/${id}/sale-history`)).status).toBe(403);
    expect((await request("/credits/1/refunds", "POST", {})).status).toBe(403);
  });
  it("reads the complete multi-return chain from either end and safely resolves deleted stock", async () => {
    const original = id;
    await issue();
    const unrelated = await newVehicle("UNRELATED");
    // An unrelated vehicle sharing a registration must never be linked.
    await db.delete(vehiclesTable).where(eq(vehiclesTable.id, unrelated));
    const returnCycle = async (reference: string, date: string) => {
      const state = GetCancellationStateResponse.parse(await (await cancel({ cancellationDate: date })).json());
      const response = await request(`/credits/${state.creditId}/refunds`, "POST", {
        reason: `Reason ${reference}`, amount: 300, paymentDate: date, recipient: "Buyer",
        method: "Bank", reference, requestKey: randomUUID(),
      });
      expect(response.status).toBe(200);
      return ConfirmSaleRefundResponse.parse(await response.json()).returnedVehicleId!;
    };
    const firstReturn = await returnCycle("CYCLE-1", "2025-10-16");
    id = firstReturn;
    await issue({ saleDate: "2025-10-17", holdingDeposit: 0, payments: [{ date: "2025-10-17", amount: 300, paymentMethod: "bank", type: "payment" }] });
    const secondReturn = await returnCycle("CYCLE-2", "2025-10-18");
    const getHistory = async (vehicleId: number) => {
      const r = await request(`/vehicles/${vehicleId}/sale-history`);
      expect(r.status).toBe(200);
      return GetVehicleSaleHistoryResponse.parse(await r.json());
    };
    const before = await getHistory(original);
    expect(await getHistory(secondReturn)).toEqual(before);
    expect(before.map((e: { type: string }) => e.type)).toEqual(["sale", "credit", "refund", "returned_stock", "sale", "credit", "refund", "returned_stock"]);
    expect(before.filter((e: { type: string }) => e.type === "refund").map((e: { reason: string }) => e.reason)).toEqual(["Reason CYCLE-1", "Reason CYCLE-2"]);
    expect((await request(`/vehicles/${firstReturn}`, "DELETE")).status).toBe(204);
    expect((await request(`/vehicles/${secondReturn}`, "DELETE")).status).toBe(204);
    const after = await getHistory(original);
    // Unsold stock has no invoice archive; its retained refund link still resolves.
    expect(after.map(({ vehicleAvailable: _, stockLabel: _label, ...event }) => event)).toEqual(before.map(({ vehicleAvailable: _, stockLabel: _label, ...event }) => event));
    expect(after.find(e => e.vehicleId === secondReturn)?.stockLabel).toBe(`Stock record #${secondReturn}`);
    expect(after.filter((e: { vehicleId: number }) => e.vehicleId !== original).every((e: { vehicleAvailable: boolean }) => !e.vehicleAvailable)).toBe(true);
    expect(await getHistory(secondReturn)).toEqual(after);
    const report = ListAccountingHistoryResponse.parse(await (await request("/accounting-history")).json());
    expect(report.filter(r => r.returnedVehicleId).every(r => r.returnedVehicleAvailable === false)).toBe(true);
    const tenant = auth.tenant;
    auth.tenant = `other-${randomUUID()}`;
    expect((await request(`/vehicles/${original}/sale-history`)).status).toBe(404);
    auth.tenant = tenant;
    expect((await request("/vehicles/not-a-number/sale-history")).status).toBe(400);
  });
  it("atomically issues one full credit under concurrent retries; a changed repeat conflicts", async () => {
    await issue();
    const results = await Promise.all([cancel(), cancel(), cancel()]);
    expect(results.map(r => r.status)).toEqual([200, 200, 200]);
    const credits = await db.select().from(saleCreditsTable).where(eq(saleCreditsTable.userId, auth.tenant));
    expect(credits).toHaveLength(1);
    expect(credits[0]).toMatchObject({ actor: "test-confirming-admin", receivedAmount: "300.00", cancellationDate: "2025-10-15" });
    expect((await cancel({ reason: "Changed" })).status).toBe(409);
    expect((await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, id)))[0]).toMatchObject({ status: "sold", saleDate: "2025-09-15", salePrice: "1600", published: false });
  });
  it("keeps September original and October reversal, including extras, after deletion and resale", async () => {
    await issue(); expect((await cancel()).status).toBe(200);
    const september = GetSalesReportResponse.parse(await (await request("/reports/sales?from=2025-09-01&to=2025-09-30")).json());
    const october = GetSalesReportResponse.parse(await (await request("/reports/sales?from=2025-10-01&to=2025-10-31")).json());
    expect(september).toHaveLength(1); expect(october).toHaveLength(1);
    expect(september[0]).toMatchObject({ salePrice: 1600, vatDue: 100 });
    expect(october[0]).toMatchObject({ salePrice: -1600, vatDue: -100, purchasePrice: 0, totalPurchaseCost: 0, accountingEntryType: "credit" });
    expect(october[0].accountingExtras?.[0]).toMatchObject({ amount: -100, vat: -20 });
    const journal = buildJournalRows(october, [], {});
    expect(journal).toHaveLength(2); expect(journal.reduce((sum, r) => sum + Number(r.taxAmount), 0)).toBe(-120);
    expect((await request(`/vehicles/${id}`, "DELETE")).status).toBe(204);
    expect(await saleReportRows(auth.tenant)).toHaveLength(2);
    const history = ListAccountingHistoryResponse.parse(await (await request("/accounting-history")).json());
    expect(history).toHaveLength(1); expect(history[0]).toMatchObject({ amount: -1720, net: -1600, vat: -120, refundDue: 300, refundState: "pending" });
    expect(JSON.parse(history[0].originalDocument).invoice.customerName).toBe("Test buyer");
    id = await newVehicle("TEST2"); await issue();
    const rows = await saleReportRows(auth.tenant);
    expect(rows).toHaveLength(3);
    expect(rows.reduce((sum, r) => sum + (r.salePrice ?? 0), 0)).toBe(1600);
    expect(new Set(rows.map(r => r.salesInvoiceNumber)).size).toBe(3);
    expect((await accountingSources(auth.tenant)).vehicles).toHaveLength(2);
  });
  it("edits buyer details without rewriting an already sold part-exchange", async () => {
    await issue({ partExchangeMake: "Ford", partExchangeModel: "B Max",
      partExchangeRegistration: "PX-TEST", partExchangeAllowance: 500 });
    const parent = GetVehicleResponse.parse(await (await request(`/vehicles/${id}`)).json());
    const pxId = parent.partExchangeVehicleId!;
    expect(pxId).toBeTruthy();
    const pxSale = await request(`/vehicles/${pxId}/sale`, "POST", {
      saleDate: "2025-09-20", buyerName: "PX buyer", buyerAddress: "PX address", salePrice: 1200,
    });
    expect(pxSale.status).toBe(200);
    const [pxBefore] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, pxId));
    const edit = await request(`/vehicles/${id}`, "PATCH", {
      expectedEditVersion: parent.editVersion, buyerName: "Corrected buyer",
      buyerAddress: "Corrected address", salePrice: parent.salePrice,
      partExchangeMake: parent.partExchangeMake, partExchangeModel: parent.partExchangeModel,
      partExchangeRegistration: parent.partExchangeRegistration,
      partExchangeAllowance: parent.partExchangeAllowance,
    });
    expect(edit.status, await edit.clone().text()).toBe(200);
    const saved = GetVehicleResponse.parse(await (await request(`/vehicles/${id}`)).json());
    expect(saved.buyerAddress).toBe("Corrected address");
    const [pxAfter] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, pxId));
    expect(pxAfter).toEqual(pxBefore);
    const history = ListAccountingHistoryResponse.parse(await (await request("/accounting-history")).json());
    const revision = history.find(r => r.type === "correction")!;
    expect(JSON.parse(revision.originalDocument).afterInvoice.customerAddress).toBe("Corrected address");
  });
  it("audits sale and purchase corrections while retaining issuance and using corrected totals", async () => {
    await issue();
    const original = await db.select().from(issuedSalesTable).where(eq(issuedSalesTable.userId, auth.tenant));
    const patch = async (changes: object) => {
      const v = GetVehicleResponse.parse(await (await request(`/vehicles/${id}`)).json());
      return request(`/vehicles/${id}`, "PATCH", { ...changes, expectedEditVersion: v.editVersion });
    };
    expect((await patch({ purchasePrice: 1100, purchaseDate: "2025-08-10", sellerName: "Correct seller" })).status).toBe(200);
    expect((await patch({ salePrice: 1800, buyerName: "Correct buyer", buyerAddress: "Correct address" })).status).toBe(200);
    expect(await db.select().from(issuedSalesTable).where(eq(issuedSalesTable.userId, auth.tenant))).toEqual(original);
    const rows = await saleReportRows(auth.tenant);
    expect(rows[0]).toMatchObject({ purchasePrice: 1100, salePrice: 1800 });
    const state = GetCancellationStateResponse.parse(await (await request(`/vehicles/${id}/cancellation`)).json());
    expect(state.gross).toBe(1920);
    const history = ListAccountingHistoryResponse.parse(await (await request("/accounting-history")).json());
    const corrections = history.filter(r => r.type === "correction");
    expect(corrections).toHaveLength(2);
    expect(corrections.every(r => r.actor === "test-confirming-admin")).toBe(true);
    const saleChange = corrections.find(r => JSON.parse(r.originalDocument).afterInvoice.customerName === "Correct buyer")!;
    expect(JSON.parse(saleChange.originalDocument).beforeInvoice.salePrice).toBe("1600");
    expect((await cancel()).status).toBe(200);
    const afterCredit = await saleReportRows(auth.tenant);
    expect(afterCredit.find(r => r.accountingEntryType === "credit")?.salePrice).toBe(-1800);
    const credited = GetCancellationStateResponse.parse(await (await request(`/vehicles/${id}/cancellation`)).json());
    const refund = await request(`/credits/${credited.creditId}/refunds`, "POST", {
      reason: "Corrected sale returned", amount: 300, paymentDate: "2025-10-16",
      recipient: "Correct buyer", method: "bank", reference: "CORRECTED-RETURN", requestKey: randomUUID(),
    });
    expect(refund.status).toBe(200);
    const returnedId = ConfirmSaleRefundResponse.parse(await refund.json()).returnedVehicleId!;
    const timeline = GetVehicleSaleHistoryResponse.parse(await (await request(`/vehicles/${returnedId}/sale-history`)).json());
    expect(timeline.find(e => e.type === "sale")?.amount).toBe(1720);
    expect(timeline.find(e => e.type === "credit")?.amount).toBe(-1920);
    const correction = timeline.find(e => e.type === "correction" && e.correctedAmount === 1920)!;
    expect(correction.previousAmount).toBe(1720);
    expect(JSON.parse(correction.originalDocument!).afterInvoice.salePrice).toBe("1800");
    expect(timeline.filter(e => e.type === "correction")).toHaveLength(2);
    expect(GetVehicleSaleHistoryResponse.parse(await (await request(`/vehicles/${id}/sale-history`)).json())).toEqual(timeline);
    expect((await patch({ salePrice: 1900 })).status).toBe(409);
    expect((await request(`/vehicles/${id}`, "DELETE")).status).toBe(204);
    const retained = GetVehicleSaleHistoryResponse.parse(await (await request(`/vehicles/${returnedId}/sale-history`)).json());
    expect(retained.filter(e => e.type === "correction").map(e => e.originalDocument)).toEqual(timeline.filter(e => e.type === "correction").map(e => e.originalDocument));
    expect(ListAccountingHistoryResponse.parse(await (await request("/accounting-history")).json()).filter(r => r.type === "correction")).toHaveLength(2);
  });
  it("allows Edit Vehicle metadata without changing issued or cancelled accounting", async () => {
    await issue();
    const original = await db.select().from(issuedSalesTable).where(eq(issuedSalesTable.userId, auth.tenant));
    for (const cancelled of [false, true]) {
      if (cancelled) await cancel();
      const vehicle = GetVehicleResponse.parse(await (await request(`/vehicles/${id}`)).json());
      const edited = await request(`/vehicles/${id}`, "PATCH", {
        expectedEditVersion: vehicle.editVersion,
        make: vehicle.make, model: vehicle.model,
        registrationNumber: vehicle.registrationNumber,
        purchaseDate: vehicle.purchaseDate, purchasePrice: vehicle.purchasePrice,
        purchaseVat: vehicle.purchaseVat, vatQualifying: vehicle.vatQualifying,
        purchaseType: vehicle.purchaseType, sellerName: vehicle.sellerName,
        description: cancelled ? "Corrected description" : "Updated description",
        colour: "Blue", published: false, photoUrls: [],
      });
      expect(edited.status, await edited.clone().text()).toBe(200);
      expect(GetVehicleResponse.parse(await edited.json()).colour).toBe("Blue");
      expect(await db.select().from(issuedSalesTable).where(eq(issuedSalesTable.userId, auth.tenant))).toEqual(original);
    }
  });
  it.each([false, true])("accepts the complete cancelled Edit Sale form with unchanged invoice settings (extras=%s)", async (hasExtras) => {
    await issue({ payments: [], extras: hasExtras ? [{ description: "Fee", amount: 100, vat: 0 }] : undefined });
    expect((await cancel({ receivedAmount: 100 })).status).toBe(200);
    const original = await db.select().from(issuedSalesTable).where(eq(issuedSalesTable.userId, auth.tenant));
    const credits = await db.select().from(saleCreditsTable).where(eq(saleCreditsTable.userId, auth.tenant));
    const invoiceBefore = await (await request(`/vehicles/${id}/invoice`)).json();
    const vehicle = GetVehicleResponse.parse(await (await request(`/vehicles/${id}`)).json());
    const inv = vehicle.editInvoice!;
    // Mirror the real form, including fields stored ONLY on the invoice and
    // its []/false defaults for a sale with no extras or finance company.
    const payload = {
      expectedEditVersion: vehicle.editVersion,
      saleDate: vehicle.saleDate, salesInvoiceNumber: vehicle.salesInvoiceNumber,
      buyerName: vehicle.buyerName, buyerAddress: "Complete form corrected address",
      buyerEmail: vehicle.buyerEmail || null, buyerPhone: vehicle.buyerPhone || null,
      salePrice: vehicle.salePrice, saleVat: vehicle.saleVat ?? null,
      paymentMethod: vehicle.paymentMethod || undefined,
      numberOfPayments: vehicle.numberOfPayments ?? null, payments: null,
      partExchangeAllowance: vehicle.partExchangeAllowance ?? undefined,
      partExchangeMake: vehicle.partExchangeMake || null,
      partExchangeModel: vehicle.partExchangeModel || null,
      partExchangeRegistration: vehicle.partExchangeRegistration || null,
      partExchangeMileage: vehicle.partExchangeMileage ?? null,
      saleNotes: vehicle.saleNotes || undefined, invoiceNotes: vehicle.invoiceNotes || null,
      financeCompanyName: inv.financeCompanyName || null,
      financeCompanyAddress: inv.financeCompanyAddress || null,
      financeCompanyEmail: inv.financeCompanyEmail || null,
      extras: (inv.extras ?? []).map(e => ({ description: e.description, amount: e.amount,
        vat: e.vat ? e.vat : undefined, onFinanceInvoice: false })),
      extrasOnFinanceInvoice: false,
    };
    const result = await request(`/vehicles/${id}`, "PATCH", payload);
    expect(result.status, await result.clone().text()).toBe(200);
    const saved = GetVehicleResponse.parse(await (await request(`/vehicles/${id}`)).json());
    expect(saved.buyerAddress).toBe(payload.buyerAddress);
    // A real invoice-setting change must still fail, not be silently discarded.
    for (const change of [{ financeCompanyName: "Different lender" },
      { extrasOnFinanceInvoice: true }, { extras: [{ description: "New fee", amount: 123 }] },
      { payments: [{ date: "2025-09-15", amount: 100, paymentMethod: "bank", type: "payment" }] }]) {
      expect((await request(`/vehicles/${id}`, "PATCH", {
        ...payload, expectedEditVersion: saved.editVersion, ...change,
      })).status).toBe(409);
    }
    expect(await db.select().from(issuedSalesTable).where(eq(issuedSalesTable.userId, auth.tenant))).toEqual(original);
    expect(await db.select().from(saleCreditsTable).where(eq(saleCreditsTable.userId, auth.tenant))).toEqual(credits);
    expect(await (await request(`/vehicles/${id}/invoice`)).json()).toEqual(invoiceBefore);
    const history = ListAccountingHistoryResponse.parse(await (await request("/accounting-history")).json());
    expect(history.filter(r => r.type === "correction")).toHaveLength(1);
  });
  it("allows cancelled-sale buyer contact corrections without changing retained accounting", async () => {
    await issue(); expect((await cancel()).status).toBe(200);
    const original = await db.select().from(issuedSalesTable).where(eq(issuedSalesTable.userId, auth.tenant));
    const credits = await db.select().from(saleCreditsTable).where(eq(saleCreditsTable.userId, auth.tenant));
    const postings = await saleReportRows(auth.tenant);
    const invoice = await (await request(`/vehicles/${id}/invoice`)).json();
    for (const admin of [false, true]) {
      auth.admin = admin;
      for (const [field, value] of Object.entries({
        buyerName: `Corrected ${admin}`, buyerAddress: `Corrected address ${admin}`,
        buyerEmail: `corrected-${admin}@example.com`, buyerPhone: admin ? "02070000002" : "02070000001",
      })) {
        const vehicle = GetVehicleResponse.parse(await (await request(`/vehicles/${id}`)).json());
        const result = await request(`/vehicles/${id}`, "PATCH", {
          expectedEditVersion: vehicle.editVersion, [field]: value,
        });
        expect(result.status, await result.clone().text()).toBe(200);
        const saved = GetVehicleResponse.parse(await (await request(`/vehicles/${id}`)).json());
        expect(saved[field as "buyerName" | "buyerAddress" | "buyerEmail" | "buyerPhone"]).toBe(value);
      }
    }
    expect(await db.select().from(issuedSalesTable).where(eq(issuedSalesTable.userId, auth.tenant))).toEqual(original);
    expect(await db.select().from(saleCreditsTable).where(eq(saleCreditsTable.userId, auth.tenant))).toEqual(credits);
    expect(await saleReportRows(auth.tenant)).toEqual(postings);
    expect(await (await request(`/vehicles/${id}/invoice`)).json()).toEqual(invoice);
    const history = ListAccountingHistoryResponse.parse(await (await request("/accounting-history")).json());
    const corrections = history.filter(r => r.type === "correction");
    expect(corrections).toHaveLength(8);
    expect(corrections.some(r => JSON.parse(r.originalDocument).afterVehicle.buyerAddress === "Corrected address true")).toBe(true);
  });
  it("prevents generic admin mutation and invoice recreation from rewriting issuance or credit", async () => {
    await issue(); await cancel();
    const before = await db.select().from(issuedSalesTable).where(eq(issuedSalesTable.userId, auth.tenant));
    expect(before[0].vehicle.issuedAccounting).toMatchObject({ gross: 1720, net: 1600, vat: 120, margin: 600, vatDue: 100, netMargin: 500 });
    const vehicle = GetVehicleResponse.parse(await (await request(`/vehicles/${id}`)).json());
    for (const fields of [{ salePrice: 999 }, { purchasePrice: 1 }, { status: "in_stock" }, { saleDate: "2025-10-01" }, { payments: [] }]) {
      expect((await request(`/vehicles/${id}`, "PATCH", { ...fields, expectedEditVersion: vehicle.editVersion })).status).toBe(409);
    }
    auth.admin = false;
    expect((await request(`/vehicles/${id}`, "PATCH", { salePrice: 1, expectedEditVersion: vehicle.editVersion })).status).toBe(409);
    auth.admin = true;
    expect((await request(`/vehicles/${id}/sale`, "POST", { ...sale, salePrice: 100 })).status).toBe(409);
    const inv = before[0].invoice;
    const recreate = await request(`/vehicles/${id}/invoice`, "POST", { invoiceNumber: inv.invoiceNumber, invoiceDate: inv.invoiceDate, customerName: "Changed", customerAddress: "Changed", salePrice: 99, balancePayable: 99 });
    expect(recreate.status).toBe(201); expect(GetInvoiceResponse.parse(await recreate.json()).salePrice).toBe(1600);
    const history = ListAccountingHistoryResponse.parse(await (await request("/accounting-history")).json());
    for (const method of ["PATCH", "DELETE"]) expect((await request(`/credits/${history[0].creditId}`, method, { reason: "Erase" })).status).toBe(404);
    expect(await db.select().from(issuedSalesTable).where(eq(issuedSalesTable.userId, auth.tenant))).toEqual(before);
    // A legacy parent/PX relationship is another generic edit path into stock.
    const [parent] = await db.insert(vehiclesTable).values({
      userId: auth.tenant, stockNumber: "PARENT", purchaseNumber: "PUR-PARENT",
      registrationNumber: "PARENT-REG", make: "Parent", model: "Car",
      purchaseDate: "2025-07-01", purchasePrice: "100", purchaseType: "private", sellerName: "Seller",
      status: "sold", saleDate: "2025-08-01", salePrice: "1000", buyerName: "Buyer", buyerAddress: "Address",
      salesInvoiceNumber: "LEGACY-10", partExchangeVehicleId: id, partExchangeAllowance: "100",
      partExchangeMake: "Test", partExchangeModel: "Car", partExchangeRegistration: "CREDIT-TEST",
    }).returning();
    const parentVersion = GetVehicleResponse.parse(await (await request(`/vehicles/${parent.id}`)).json()).editVersion;
    expect((await request(`/vehicles/${parent.id}`, "PATCH", { salePrice: 1001, expectedEditVersion: parentVersion })).status).toBe(200);
    const updatedParentVersion = GetVehicleResponse.parse(await (await request(`/vehicles/${parent.id}`)).json()).editVersion;
    expect((await request(`/vehicles/${parent.id}`, "PATCH", { partExchangeAllowance: 999, expectedEditVersion: updatedParentVersion })).status).toBe(409);
    expect((await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, id)))[0].status).toBe("sold");
  });
  it("requires receipts reconciliation, rejects invalid dates and blocks unresolved finance/PX", async () => {
    await issue();
    expect((await cancel({ receivedAmount: 99 })).status).toBe(409);
    expect((await cancel({ receivedAmount: 200 })).status).toBe(409);
    expect((await cancel({ receivedAmount: 1721 })).status).toBe(409);
    expect((await cancel({ cancellationDate: "2025-02-30" })).status).toBe(400);
    expect((await cancel({ cancellationDate: "2025-08-01" })).status).toBe(409);
    id = await newVehicle("FINANCE"); await issue({ financeCompanyName: "Test lender" });
    expect((await cancel()).status).toBe(409);
    expect(GetCancellationStateResponse.parse(await (await request(`/vehicles/${id}/cancellation`)).json()).message).toContain("Finance");
  });
  it("records paid refunds separately, serializes limits, rejects duplicate references and survives deletion", async () => {
    await issue(); const state = GetCancellationStateResponse.parse(await (await cancel()).json());
    const path = `/credits/${state.creditId}/refunds`;
    const paid = { reason: "Vehicle returned with fault", amount: 100, paymentDate: "2025-10-16", recipient: "Test buyer", method: "Bank", reference: "TRANSFER-1", requestKey: randomUUID() };
    expect((await request(path, "POST", { ...paid, reason: " " })).status).toBe(400);
    expect((await request(path, "POST", { ...paid, amount: 301 })).status).toBe(409);
    const concurrent = await Promise.all([request(path, "POST", paid), request(path, "POST", paid)]);
    expect(concurrent.map(r => r.status)).toEqual([200, 200]);
    expect((await request(path, "POST", { ...paid, requestKey: randomUUID(), reference: " transfer-1 " })).status).toBe(409);
    expect((await request(path, "POST", { ...paid, amount: 200 })).status).toBe(409);
    const partial = ListAccountingHistoryResponse.parse(await (await request("/accounting-history")).json());
    expect(partial.find((r: { type: string }) => r.type === "credit")).toMatchObject({ refundDue: 200, refundState: "partially refunded" });
    const final = { ...paid, amount: 200, reference: "TRANSFER-2", requestKey: randomUUID() };
    const results = await Promise.all([request(path, "POST", final), request(path, "POST", { ...final, reference: "TRANSFER-3", requestKey: randomUUID() })]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    expect(await db.select().from(saleRefundsTable).where(eq(saleRefundsTable.userId, auth.tenant))).toHaveLength(2);
    const returned = (await db.select().from(vehiclesTable).where(eq(vehiclesTable.userId, auth.tenant))).find(v => v.returnedFromVehicleId === id)!;
    expect(returned).toMatchObject({ status: "in_stock", published: false, showroomSold: false,
      showroomRemoveAt: null, saleDate: null, salesInvoiceNumber: null, buyerName: null,
      purchasePrice: "1000", stockReturnDate: "2025-10-16" });
    expect(returned.purchaseNotes).toContain(paid.reason);
    const [original] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, id));
    expect(original.status).toBe("sold");
    expect(original.saleNotes).toContain(paid.reason);
    const purchases = await (await request("/reports/purchases")).json() as Array<{id: number}>;
    expect(purchases.map(v => v.id)).not.toContain(returned.id);
    const beforeReturn = await (await request("/reports/stock?date=2025-10-15")).json() as Array<{id: number}>;
    expect(beforeReturn.map(v => v.id)).not.toContain(returned.id);
    const afterReturn = await (await request("/reports/stock?date=2025-10-16")).json() as Array<{id: number}>;
    expect(afterReturn.map(v => v.id)).toContain(returned.id);
    expect((await request(`/vehicles/${id}`, "DELETE")).status).toBe(204);
    const entries = ListAccountingHistoryResponse.parse(await (await request("/accounting-history")).json());
    expect(entries).toHaveLength(3);
    expect(entries.every((r: { refundDue: number; refundState: string }) => r.refundDue === 0 && r.refundState === "fully refunded")).toBe(true);
    expect(await saleReportRows(auth.tenant)).toHaveLength(2); // Payments never add VAT postings.
  });
  it("includes retained historical deposit refunds with explicitly unknown actors", async () => {
    await db.insert(depositRefundsTable).values({ userId: auth.tenant, vehicleId: id, stockNumber: "OLD", registrationNumber: "OLD", make: "Test", model: "Car", depositAmount: "100", refundDate: "2025-08-01" });
    const entries = ListAccountingHistoryResponse.parse(await (await request("/accounting-history")).json());
    expect(entries[0]).toMatchObject({ type: "deposit_refund", actor: "Historical actor unknown", amount: 100, vat: 0 });
  });
  it("records no refund due when explicitly reconciled receipts are zero", async () => {
    await db.update(vehiclesTable).set({ holdingDepositAmount: null }).where(eq(vehiclesTable.id, id));
    await issue({ holdingDeposit: 0, payments: [] });
    expect((await cancel({ receivedAmount: 0, reconciliation: "No deposit or payments received; full balance unpaid." })).status).toBe(200);
    const history = ListAccountingHistoryResponse.parse(await (await request("/accounting-history")).json());
    expect(history[0]).toMatchObject({ refundState: "no refund due", refundDue: 0 });
    expect((await request(`/credits/${history[0].creditId}/refunds`, "POST", { reason: "Return", amount: 1, paymentDate: "2025-10-15", recipient: "Buyer", method: "Bank", reference: "NO-RECEIPTS", requestKey: randomUUID() })).status).toBe(409);
  });
  it("allows operational receipt updates before cancellation, then freezes and retains them", async () => {
    await issue();
    const original = await db.select().from(issuedSalesTable).where(eq(issuedSalesTable.userId, auth.tenant));
    const version = GetVehicleResponse.parse(await (await request(`/vehicles/${id}`)).json()).editVersion;
    const payments = [{ date: "2025-10-01", amount: 400, paymentMethod: "Bank", type: "Payment from Customer" }];
    expect((await request(`/vehicles/${id}`, "PATCH", { payments, numberOfPayments: 1, expectedEditVersion: version })).status).toBe(200);
    expect((await request(`/vehicles/${id}`, "PATCH", { payments: [], expectedEditVersion: version })).status).toBe(409);
    expect((await cancel()).status).toBe(409); // 100 deposit + latest 400 receipts.
    expect((await cancel({ receivedAmount: 500 })).status).toBe(200);
    const current = GetVehicleResponse.parse(await (await request(`/vehicles/${id}`)).json());
    expect((await request(`/vehicles/${id}`, "PATCH", { payments: [], expectedEditVersion: current.editVersion })).status).toBe(409);
    expect(await db.select().from(issuedSalesTable).where(eq(issuedSalesTable.userId, auth.tenant))).toEqual(original);
    const history = ListAccountingHistoryResponse.parse(await (await request("/accounting-history")).json());
    expect(JSON.parse(history.find(r => r.type === "credit")!.originalDocument).receiptsAtCancellation).toEqual(payments);
  });
});

describe("credit accounting period rules", () => {
  const vehicle = { id: 1, stockNumber: "1", registrationNumber: "TEST", make: "Test", model: "Car", status: "sold", purchaseDate: "2025-08-01", saleDate: "2025-09-15", purchasePrice: 1000, auctionCostNoVat: null, vatQualifying: false, purchaseVat: null, saleVat: null, salePrice: 1600 };
  const credit = { creditNumber: "CR-2", date: "2025-10-15", salePrice: 1600, margin: 600, marginVat: 100, standardVat: 20 };
  it("retains September VAT and subtracts in October; never reverses purchases", () => {
    const invoices = [{ invoiceNumber: "INV-1", invoiceDate: "2025-09-15", extras: [{ vat: 20 }] }];
    const sept = computeDashboardSummary([vehicle], invoices, new Date(2025, 8, 20), null, [credit]);
    const oct = computeDashboardSummary([vehicle], invoices, new Date(2025, 9, 20), null, [credit]);
    expect(sept.totalSalesThisMonth).toBe(1600); expect(sept.vatDueThisMonth).toBe(120);
    expect(oct.totalSalesThisMonth).toBe(-1600); expect(oct.vatDueThisMonth).toBe(-120);
    expect(oct.totalPurchasesThisMonth).toBe(0);
    expect(sept.totalSalesThisMonth + oct.totalSalesThisMonth).toBe(0);
    expect(sept.netMarginThisMonth + oct.netMarginThisMonth).toBe(0);
  });
  it("validates dates and money without inventing rounded receipts", () => {
    expect(validDate("2025-02-30")).toBe(false); expect(validDate("2025-02-28")).toBe(true);
    expect(validMoney(1.001)).toBe(false); expect(validMoney(1.01)).toBe(true);
  });
  it("reverses standard output VAT without reversing original or unrelated input VAT", () => {
    const standard = { ...vehicle, vatQualifying: true, saleVat: 320, purchaseVat: 200 };
    const currentPurchase = { ...vehicle, id: 2, status: "in_stock", purchaseDate: "2025-10-01", saleDate: null, salePrice: null, purchasePrice: 400, vatQualifying: true, purchaseVat: 80 };
    const postedCredit = { ...credit, marginVat: 0, standardVat: 340 };
    const invoices = [{ invoiceNumber: "INV-1", invoiceDate: "2025-09-15", extras: [{ vat: 20 }] }];
    const result = computeDashboardSummary([standard, currentPurchase], invoices, new Date(2025, 9, 20), null, [postedCredit]);
    expect(result.totalPurchasesThisMonth).toBe(400);
    expect(result.vatDueThisMonth).toBe(-420);
    expect(result.totalStockValue).toBe(400);
  });
});
