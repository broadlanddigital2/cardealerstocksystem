/**
 * Unit tests for the VAT Margin Scheme calculations and the invoice
 * balancePayable derivation. These figures go straight onto customer
 * invoices and VAT reports, so regressions here are costly.
 *
 * Rules under test:
 * - margin = sale − purchase
 * - VAT due = one-sixth of the margin, only when the margin is positive
 * - net margin = margin − VAT due
 * - balancePayable = salePrice + saleVat − partExchange − holdingDeposit
 *   (+ extras gross only when billed on the finance/vehicle invoice)
 * - all money values rounded to pennies
 */
import { describe, expect, it } from "vitest";
import {
  computeMargins,
  serializeInvoice,
} from "../lib/vehicleSerializer.js";

describe("computeMargins", () => {
  it("computes margin, VAT (one-sixth) and net margin for a positive margin", () => {
    // Bought £8,000, sold £10,000 → margin £2,000, VAT £333.33, net £1,666.67
    const r = computeMargins(8000, 10000);
    expect(r.margin).toBe(2000);
    expect(r.vatDue).toBe(333.33);
    expect(r.netMargin).toBe(1666.67);
  });

  it("charges no VAT on a zero margin", () => {
    const r = computeMargins(5000, 5000);
    expect(r.margin).toBe(0);
    expect(r.vatDue).toBe(0);
    expect(r.netMargin).toBe(0);
  });

  it("charges no VAT on a negative margin (sold at a loss)", () => {
    const r = computeMargins(7500, 6000);
    expect(r.margin).toBe(-1500);
    expect(r.vatDue).toBe(0);
    expect(r.netMargin).toBe(-1500);
  });

  it("returns all nulls when the vehicle is unsold (no sale price)", () => {
    expect(computeMargins(8000, null)).toEqual({
      margin: null,
      vatDue: null,
      netMargin: null,
    });
  });

  it("rounds every figure to pennies", () => {
    // margin £100.01 → VAT £16.668333… → £16.67, net £83.34
    const r = computeMargins(899.99, 1000);
    expect(r.margin).toBe(100.01);
    expect(r.vatDue).toBe(16.67);
    expect(r.netMargin).toBe(83.34);
  });

  it("handles penny-level margins without floating point drift", () => {
    // 0.03 margin → VAT 0.005 → rounds to 0.01 (round-half-up), net 0.02
    const r = computeMargins(9999.97, 10000);
    expect(r.margin).toBe(0.03);
    expect(r.vatDue).toBe(0.01);
    expect(r.netMargin).toBe(0.02);
  });

  it("never returns more than 2 decimal places on realistic prices", () => {
    const r = computeMargins(1234.56, 6543.21);
    expect(r.margin).toBe(5308.65);
    expect(r.vatDue).toBe(884.78); // 5308.65 / 6 = 884.775 → 884.78
    expect(r.netMargin).toBe(4423.87);
    for (const v of [r.margin, r.vatDue, r.netMargin]) {
      expect(Math.round((v as number) * 100) / 100).toBe(v);
    }
  });
});

// --- balancePayable derivation (serializeInvoice) ---

type InvoiceRow = Parameters<typeof serializeInvoice>[0];

function invoiceRow(overrides: Partial<InvoiceRow> = {}): InvoiceRow {
  return {
    id: 1,
    vehicleId: 1,
    invoiceNumber: "INV-001",
    invoiceDate: "2026-07-01",
    customerName: "A Buyer",
    customerAddress: "1 High Street",
    salePrice: "10000.00",
    saleVat: null,
    paymentMethod: null,
    partExchangeAllowance: null,
    balancePayable: "0.00", // stored value is ignored; derived on read
    holdingDeposit: null,
    extras: null,
    extrasOnFinanceInvoice: false,
    notes: null,
    financeCompanyName: null,
    financeCompanyAddress: null,
    financeCompanyEmail: null,
    createdAt: new Date("2026-07-01T00:00:00Z"),
    ...overrides,
  };
}

describe("serializeInvoice balancePayable", () => {
  it("is the full sale price for a plain margin-scheme sale", () => {
    expect(serializeInvoice(invoiceRow()).balancePayable).toBe(10000);
  });

  it("deducts a holding deposit", () => {
    const out = serializeInvoice(invoiceRow({ holdingDeposit: "500.00" }));
    expect(out.balancePayable).toBe(9500);
  });

  it("deducts a part-exchange allowance", () => {
    const out = serializeInvoice(
      invoiceRow({ partExchangeAllowance: "2500.00" }),
    );
    expect(out.balancePayable).toBe(7500);
  });

  it("adds sale VAT for a VAT-qualifying sale", () => {
    const out = serializeInvoice(
      invoiceRow({ salePrice: "10000.00", saleVat: "2000.00" }),
    );
    expect(out.balancePayable).toBe(12000);
  });

  it("combines VAT, part-exchange and deposit (finance-style sale)", () => {
    // 10000 + 2000 VAT − 2500 PX − 500 deposit = 9000
    const out = serializeInvoice(
      invoiceRow({
        saleVat: "2000.00",
        partExchangeAllowance: "2500.00",
        holdingDeposit: "500.00",
      }),
    );
    expect(out.balancePayable).toBe(9000);
  });

  it("excludes extras billed on a separate extras invoice", () => {
    const out = serializeInvoice(
      invoiceRow({
        extras: [{ description: "Warranty", amount: 300, vat: 60 }],
        extrasOnFinanceInvoice: false,
      }),
    );
    expect(out.balancePayable).toBe(10000);
  });

  it("adds gross extras when billed on the finance/vehicle invoice (legacy invoice-level flag)", () => {
    const out = serializeInvoice(
      invoiceRow({
        extras: [{ description: "Warranty", amount: 300, vat: 60 }],
        extrasOnFinanceInvoice: true,
      }),
    );
    expect(out.balancePayable).toBe(10360);
  });

  it("honours the per-item onFinanceInvoice flag over the invoice-level flag", () => {
    const out = serializeInvoice(
      invoiceRow({
        extras: [
          { description: "Warranty", amount: 300, vat: 60, onFinanceInvoice: true },
          { description: "Mats", amount: 50, vat: 10, onFinanceInvoice: false },
        ],
        extrasOnFinanceInvoice: false,
      }),
    );
    // Only the warranty (300 + 60) is added.
    expect(out.balancePayable).toBe(10360);
  });

  it("treats a missing per-item VAT as zero", () => {
    const out = serializeInvoice(
      invoiceRow({
        extras: [{ description: "Delivery", amount: 100, onFinanceInvoice: true }],
      }),
    );
    expect(out.balancePayable).toBe(10100);
  });

  it("rounds the derived balance to pennies", () => {
    const out = serializeInvoice(
      invoiceRow({
        salePrice: "10000.10",
        saleVat: "0.01",
        partExchangeAllowance: "0.02",
        holdingDeposit: "0.03",
        extras: [{ description: "Fee", amount: 0.1, vat: 0.02, onFinanceInvoice: true }],
        extrasOnFinanceInvoice: true,
      }),
    );
    // 10000.10 + 0.01 − 0.02 − 0.03 + 0.12 = 10000.18
    expect(out.balancePayable).toBe(10000.18);
  });

  it("can go negative when deductions exceed the sale price", () => {
    const out = serializeInvoice(
      invoiceRow({
        salePrice: "1000.00",
        partExchangeAllowance: "1500.00",
      }),
    );
    expect(out.balancePayable).toBe(-500);
  });
});
