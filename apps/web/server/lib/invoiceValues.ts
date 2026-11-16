import type { InvoiceInput } from "@workspace/api-zod";
import { calculateInvoiceBalance } from "./vehicleSerializer";
import { isDeepStrictEqual } from "./deepEqual";

/** Shared by atomic sales and historical invoice recovery. Never trust client totals. */
export function invoiceValues(userId: string, vehicleId: number, d: InvoiceInput & { invoiceNumber: string }) {
  const extrasOnFinanceInvoice =
    (d.extras ?? []).some(e => e.onFinanceInvoice) ||
    (d.extrasOnFinanceInvoice ?? false);
  return {
    userId, vehicleId,
    invoiceNumber: d.invoiceNumber,
    invoiceDate: d.invoiceDate,
    customerName: d.customerName,
    customerAddress: d.customerAddress,
    salePrice: String(d.salePrice),
    saleVat: d.saleVat != null ? String(d.saleVat) : null,
    paymentMethod: d.paymentMethod ?? null,
    partExchangeAllowance: d.partExchangeAllowance != null ? String(d.partExchangeAllowance) : null,
    balancePayable: String(calculateInvoiceBalance({ ...d, extrasOnFinanceInvoice })),
    holdingDeposit: d.holdingDeposit != null ? String(d.holdingDeposit) : null,
    extras: d.extras ?? null,
    extrasOnFinanceInvoice,
    notes: d.notes ?? null,
    financeCompanyName: d.financeCompanyName ?? null,
    financeCompanyAddress: d.financeCompanyAddress ?? null,
    financeCompanyEmail: d.financeCompanyEmail ?? null,
  };
}

const moneyKeys = new Set(["salePrice", "saleVat", "partExchangeAllowance", "holdingDeposit", "balancePayable"]);

/** Compare only supplied persisted fields; PostgreSQL numeric strings may have scale. */
export function matchesSavedFields(saved: object, expected: object): boolean {
  const row = saved as Record<string, unknown>;
  return Object.entries(expected).every(([key, value]) => {
    if (moneyKeys.has(key) && value != null && row[key] != null) {
      return Number(row[key]) === Number(value);
    }
    // JSONB drops undefined properties and does not retain object key ordering.
    return isDeepStrictEqual(row[key], value == null ? value : JSON.parse(JSON.stringify(value)));
  });
}
