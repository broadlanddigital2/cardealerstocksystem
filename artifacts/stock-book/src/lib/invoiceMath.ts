/**
 * Pure money maths for the client-side invoice PDF generators.
 *
 * These derivations MUST stay in lockstep with the server-side
 * balancePayable derivation in
 * `artifacts/api-server/src/lib/vehicleSerializer.ts` (serializeInvoice):
 *
 *   balancePayable = salePrice + saleVat − partExchange − holdingDeposit
 *                    + gross extras billed on the finance/vehicle invoice
 *
 * The unit tests in `invoiceMath.test.ts` mirror the server test matrix in
 * `artifacts/api-server/test/margin-calc.test.ts`, so a drift between the
 * figures printed on a PDF and the figures shown in the app fails a test.
 */

export interface InvoiceExtraLike {
  description: string;
  amount: number;
  vat?: number;
  onFinanceInvoice?: boolean;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Extras billed on the finance/vehicle invoice itself. Legacy extras have no
 * per-item flag, so they fall back to the invoice-level
 * `extrasOnFinanceInvoice` choice — identical to the server-side filter.
 */
export function selectFinanceInvoiceExtras<T extends InvoiceExtraLike>(
  extras: T[] | null | undefined,
  invoiceLevelFlag: boolean | null | undefined,
): T[] {
  return (extras ?? []).filter(
    (e) => e.onFinanceInvoice ?? invoiceLevelFlag ?? false,
  );
}

/** Extras billed on the separate extras VAT invoice (the complement). */
export function selectSeparateInvoiceExtras<T extends InvoiceExtraLike>(
  extras: T[] | null | undefined,
  invoiceLevelFlag: boolean | null | undefined,
): T[] {
  return (extras ?? []).filter(
    (e) => !(e.onFinanceInvoice ?? invoiceLevelFlag ?? false),
  );
}

export interface MarginInvoiceTotals {
  /** Gross (inc. VAT) total of the extras included on this invoice. */
  extrasGross: number;
  balancePayable: number;
}

/**
 * Totals for the margin-scheme sales invoice. There is no separate sale VAT
 * line — the sale price is the gross price.
 */
export function computeMarginInvoiceTotals(input: {
  salePrice: number;
  partExchangeAllowance?: number | null;
  holdingDeposit?: number | null;
  /** Extras already selected for this invoice (see selectFinanceInvoiceExtras). */
  extras?: InvoiceExtraLike[] | null;
}): MarginInvoiceTotals {
  const extras = input.extras ?? [];
  const extrasGross = round2(
    extras.reduce((sum, e) => sum + e.amount + (e.vat ?? 0), 0),
  );
  const balancePayable = round2(
    input.salePrice -
      (input.partExchangeAllowance ?? 0) -
      (input.holdingDeposit ?? 0) +
      extrasGross,
  );
  return { extrasGross, balancePayable };
}

export interface VatInvoiceTotals {
  extrasNet: number;
  extrasVat: number;
  subtotalNet: number;
  vatTotal: number;
  grossTotal: number;
  balancePayable: number;
}

/**
 * Totals for the standard VAT sales invoice (VAT-qualifying vehicle). The sale
 * price is net; VAT is a separate line. Extras included on this invoice fold
 * into the net subtotal and VAT total.
 */
export function computeVatInvoiceTotals(input: {
  salePrice: number;
  saleVat?: number | null;
  partExchangeAllowance?: number | null;
  holdingDeposit?: number | null;
  /** Extras already selected for this invoice (see selectFinanceInvoiceExtras). */
  extras?: InvoiceExtraLike[] | null;
}): VatInvoiceTotals {
  const extras = input.extras ?? [];
  const extrasNet = round2(extras.reduce((sum, e) => sum + e.amount, 0));
  const extrasVat = round2(extras.reduce((sum, e) => sum + (e.vat ?? 0), 0));
  const subtotalNet = round2(input.salePrice + extrasNet);
  const vatTotal = round2((input.saleVat ?? 0) + extrasVat);
  const grossTotal = round2(subtotalNet + vatTotal);
  const balancePayable = round2(
    grossTotal -
      (input.partExchangeAllowance ?? 0) -
      (input.holdingDeposit ?? 0),
  );
  return {
    extrasNet,
    extrasVat,
    subtotalNet,
    vatTotal,
    grossTotal,
    balancePayable,
  };
}

export interface ExtrasInvoiceTotals {
  netTotal: number;
  vatTotal: number;
  grossTotal: number;
}

/** Totals for the separate extras VAT invoice. */
export function computeExtrasInvoiceTotals(
  extras: InvoiceExtraLike[],
): ExtrasInvoiceTotals {
  const netTotal = round2(extras.reduce((sum, e) => sum + e.amount, 0));
  const vatTotal = round2(extras.reduce((sum, e) => sum + (e.vat ?? 0), 0));
  const grossTotal = round2(netTotal + vatTotal);
  return { netTotal, vatTotal, grossTotal };
}

/** Gross (inc. VAT) amount of a single extra line item. */
export function extraGross(extra: InvoiceExtraLike): number {
  return round2(extra.amount + (extra.vat ?? 0));
}

/**
 * The server's balancePayable derivation (serializeInvoice), used when the
 * client needs the figure before the server has stored the invoice:
 * salePrice + saleVat − partExchange − holdingDeposit + gross extras billed
 * on the finance/vehicle invoice.
 */
export function computeInvoiceBalancePayable(input: {
  salePrice: number;
  saleVat?: number | null;
  partExchangeAllowance?: number | null;
  holdingDeposit?: number | null;
  extras?: InvoiceExtraLike[] | null;
  extrasOnFinanceInvoice?: boolean | null;
}): number {
  const extrasGross = selectFinanceInvoiceExtras(
    input.extras,
    input.extrasOnFinanceInvoice,
  ).reduce((sum, e) => sum + e.amount + (e.vat ?? 0), 0);
  return round2(
    input.salePrice +
      (input.saleVat ?? 0) -
      (input.partExchangeAllowance ?? 0) -
      (input.holdingDeposit ?? 0) +
      extrasGross,
  );
}

/** Balance due on collection shown on the holding-deposit receipt. */
export function computeHoldingDepositBalance(
  salePrice: number,
  depositAmount: number,
): number {
  return round2(salePrice - depositAmount);
}
