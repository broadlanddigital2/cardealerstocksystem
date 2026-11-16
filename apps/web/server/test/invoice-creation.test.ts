import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response, NextFunction } from "../http";
import { startTestServer, type TestServer } from "./helpers/server";
import { CreateVehicleInvoiceBody } from "@workspace/api-zod";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  values: vi.fn(),
  returning: vi.fn(),
  where: vi.fn(),
  transaction: vi.fn(),
  execute: vi.fn(),
  vehiclesTable: { id: "vehicle-id", userId: "vehicle-user-id" },
  invoicesTable: { id: "invoice-id", userId: "invoice-user-id" },
  invoiceArchiveTable: { id: "archive-id", userId: "archive-user-id" },
}));

vi.mock("@workspace/db", async (importOriginal) => ({
  // Our routes take the query operators (eq, and, sql...) from @workspace/db too.
  ...(await importOriginal<typeof import("@workspace/db")>()),
  db: {
    select: mocks.select,
    insert: mocks.insert,
    update: mocks.update,
    delete: mocks.delete,
    transaction: mocks.transaction,
  },
  vehiclesTable: mocks.vehiclesTable,
  invoicesTable: mocks.invoicesTable,
  invoiceArchiveTable: mocks.invoiceArchiveTable,
  issuedSalesTable: { id: "issued-id", userId: "issued-user-id", invoiceNumber: "issued-number", vehicleId: "issued-vehicle" },
  saleCreditsTable: { id: "credit-id", userId: "credit-user-id", creditNumber: "credit-number" },
}));

vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (
    req: Request,
    _res: Response,
    next: NextFunction,
  ) => {
    req.userId = "dealer-test";
    next();
  },
}));

import invoiceRouter from "../routes/invoices";

type InvoiceInput = ReturnType<typeof CreateVehicleInvoiceBody.parse>;
const validInput: InvoiceInput = {
  invoiceNumber: "INV-0042",
  invoiceDate: "2026-07-15",
  customerName: "Invoice regression customer",
  customerAddress: "Test address",
  salePrice: 5495,
  partExchangeAllowance: 9000,
  balancePayable: -3505,
};

describe("POST /vehicles/:id/invoice", () => {
  let server: TestServer;
  let baseUrl: string;

  beforeAll(async () => {
    server = await startTestServer([invoiceRouter]);
    baseUrl = server.base;
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.transaction.mockImplementation(async (fn) => fn({
      select: mocks.select, insert: mocks.insert, execute: mocks.execute,
    }));
    mocks.select.mockReturnValue({ from: vi.fn().mockReturnValue({ where: mocks.where }) });
    const vehicle = { id: 42, userId: "dealer-test", status: "sold", salesInvoiceNumber: "INV-0042" };
    mocks.where
      .mockResolvedValueOnce([vehicle])
      .mockReturnValueOnce({ for: vi.fn().mockResolvedValue([vehicle]) })
      .mockResolvedValue([]);
    mocks.insert.mockReturnValue({ values: mocks.values });
    mocks.values.mockReturnValue({ returning: mocks.returning });
    mocks.returning.mockImplementation(async () => [{
      ...mocks.values.mock.calls[0][0],
      id: 7,
      createdAt: new Date("2026-07-15T12:00:00Z"),
    }]);
  });

  async function post(overrides: Partial<InvoiceInput> = {}) {
    const response = await fetch(`${baseUrl}/vehicles/42/invoice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validInput, ...overrides }),
    });
    const body = await response.json() as { balancePayable?: number; error?: string };
    return { status: response.status, body };
  }

  function expectInvoiceOnlyWrite(balance: number) {
    expect(mocks.select).toHaveBeenCalledTimes(8);
    expect(mocks.insert).toHaveBeenCalledExactlyOnceWith(mocks.invoicesTable);
    expect(mocks.values).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      userId: "dealer-test",
      vehicleId: 42,
      invoiceNumber: "INV-0042",
      balancePayable: String(balance),
    }));
    expect(mocks.returning).toHaveBeenCalledTimes(1);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
  }

  it("accepts PX above the sale price and persists the negative balance", async () => {
    const response = await post();
    expect(response.status).toBe(201);
    expect(response.body.balancePayable).toBe(-3505);
    expectInvoiceOnlyWrite(-3505);
  });

  it("ignores a stale client number and uses the sale reservation", async () => {
    expect((await post({ invoiceNumber: "INV-0001" })).status).toBe(201);
    expectInvoiceOnlyWrite(-3505);
  });

  it("returns the issued invoice on retry without another insert", async () => {
    const vehicle = { id: 42, salesInvoiceNumber: "INV-0042" };
    mocks.where.mockReset()
      .mockResolvedValueOnce([vehicle])
      .mockReturnValueOnce({ for: vi.fn().mockResolvedValue([vehicle]) })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...validInput, id: 7, vehicleId: 42, createdAt: new Date() }]);
    expect((await post()).status).toBe(201);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("rejects historical duplicates with a friendly conflict and no writes", async () => {
    const vehicle = { id: 42, salesInvoiceNumber: "INV-0042" };
    mocks.where.mockReset()
      .mockResolvedValueOnce([vehicle])
      .mockReturnValueOnce({ for: vi.fn().mockResolvedValue([vehicle]) })
      .mockResolvedValueOnce([{ id: 43 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const response = await post();
    expect(response.status).toBe(409);
    expect(response.body.error).toContain("Nothing was changed");
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it.each([
    { name: "positive", partExchangeAllowance: 1000, balancePayable: 4495 },
    { name: "zero", partExchangeAllowance: 5495, balancePayable: 0 },
  ])("preserves a valid $name balance", async ({ partExchangeAllowance, balancePayable }) => {
    const response = await post({ partExchangeAllowance, balancePayable });
    expect(response.status).toBe(201);
    expect(response.body.balancePayable).toBe(balancePayable);
    expectInvoiceOnlyWrite(balancePayable);
  });

  it.each([
    { name: "positive", partExchangeAllowance: 1000, supplied: -999, expected: 4495 },
    { name: "zero", partExchangeAllowance: 5495, supplied: 999, expected: 0 },
    { name: "negative", partExchangeAllowance: 9000, supplied: 999, expected: -3505 },
  ])("derives a $name balance rather than trusting the client", async ({
    partExchangeAllowance, supplied, expected,
  }) => {
    const response = await post({ partExchangeAllowance, balancePayable: supplied });
    expect(response.status).toBe(201);
    expect(response.body.balancePayable).toBe(expected);
    expectInvoiceOnlyWrite(expected);
  });

  it("includes sale VAT, deposits and only financed extras, rounding to pennies", async () => {
    const response = await post({
      salePrice: 5495.12,
      saleVat: 1099.02,
      holdingDeposit: 100.01,
      extras: [
        { description: "Financed", amount: 100.1, vat: 20.02, onFinanceInvoice: true },
        { description: "Separate", amount: 500, vat: 100, onFinanceInvoice: false },
      ],
    });
    expect(response.status).toBe(201);
    expect(response.body.balancePayable).toBe(-2385.75);
    expectInvoiceOnlyWrite(-2385.75);
  });

  it("retains legacy extras inclusion with explicit per-item exclusions", async () => {
    const response = await post({
      extrasOnFinanceInvoice: true,
      extras: [
        { description: "Legacy financed", amount: 100, vat: 20 },
        { description: "Separate", amount: 500, vat: 100, onFinanceInvoice: false },
      ],
    });
    expect(response.status).toBe(201);
    expect(response.body.balancePayable).toBe(-3385);
    expectInvoiceOnlyWrite(-3385);
  });

  it("excludes extras billed separately by default", async () => {
    const response = await post({
      extras: [{ description: "Separate", amount: 100, vat: 20 }],
    });
    expect(response.status).toBe(201);
    expect(response.body.balancePayable).toBe(-3505);
    expectInvoiceOnlyWrite(-3505);
  });

  it.each([
    { name: "sale price", input: { salePrice: -1 } },
    { name: "sale VAT", input: { saleVat: -1 } },
    { name: "part exchange", input: { partExchangeAllowance: -1 } },
    { name: "deposit", input: { holdingDeposit: -1 } },
    { name: "extra amount", input: { extras: [{ description: "Invalid", amount: -1 }] } },
    { name: "extra VAT", input: { extras: [{ description: "Invalid", amount: 1, vat: -1 }] } },
  ])("rejects negative $name without any writes", async ({ input }) => {
    const response = await post(input);
    expect(response.status).toBe(400);
    expect(response.body.error).toEqual(expect.any(String));
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
  });
});
