/**
 * Unit tests for the client-side invoice PDF money maths.
 *
 * These mirror the server-side balancePayable case matrix in
 * `artifacts/api-server/test/margin-calc.test.ts` (serializeInvoice):
 *
 *   balancePayable = salePrice + saleVat − partExchange − holdingDeposit
 *                    + gross extras billed on the finance/vehicle invoice
 *
 * If the figures a PDF would print drift from the figures the app derives on
 * the server, these tests fail.
 */
import { describe, expect, it } from "vitest";
import {
  computeExtrasInvoiceTotals,
  computeHoldingDepositBalance,
  computeInvoiceBalancePayable,
  computeMarginInvoiceTotals,
  computeVatInvoiceTotals,
  extraGross,
  round2,
  selectFinanceInvoiceExtras,
  selectSeparateInvoiceExtras,
  type InvoiceExtraLike,
} from "./invoiceMath";

/**
 * Reference implementation of the server's derivation (serializeInvoice in
 * artifacts/api-server/src/lib/vehicleSerializer.ts) used to cross-check the
 * PDF-side maths on every scenario.
 */
function serverBalancePayable(input: {
  salePrice: number;
  saleVat?: number | null;
  partExchangeAllowance?: number | null;
  holdingDeposit?: number | null;
  extras?: InvoiceExtraLike[] | null;
  extrasOnFinanceInvoice?: boolean;
}): number {
  const extrasGross = (input.extras ?? [])
    .filter((e) => e.onFinanceInvoice ?? input.extrasOnFinanceInvoice ?? false)
    .reduce((sum, e) => sum + e.amount + (e.vat ?? 0), 0);
  return round2(
    input.salePrice +
      (input.saleVat ?? 0) -
      (input.partExchangeAllowance ?? 0) -
      (input.holdingDeposit ?? 0) +
      extrasGross,
  );
}

/**
 * What the PDF layer prints for a given invoice, combining the same
 * extras-selection filter the callers use with the generator maths:
 * margin-scheme invoice when there is no sale VAT, standard VAT invoice
 * otherwise (matching the vatQualifying branch in VehicleDetail).
 */
function pdfBalancePayable(input: {
  salePrice: number;
  saleVat?: number | null;
  partExchangeAllowance?: number | null;
  holdingDeposit?: number | null;
  extras?: InvoiceExtraLike[] | null;
  extrasOnFinanceInvoice?: boolean;
}): number {
  const onInvoiceExtras = selectFinanceInvoiceExtras(
    input.extras,
    input.extrasOnFinanceInvoice,
  );
  if (input.saleVat != null) {
    return computeVatInvoiceTotals({
      salePrice: input.salePrice,
      saleVat: input.saleVat,
      partExchangeAllowance: input.partExchangeAllowance,
      holdingDeposit: input.holdingDeposit,
      extras: onInvoiceExtras,
    }).balancePayable;
  }
  return computeMarginInvoiceTotals({
    salePrice: input.salePrice,
    partExchangeAllowance: input.partExchangeAllowance,
    holdingDeposit: input.holdingDeposit,
    extras: onInvoiceExtras,
  }).balancePayable;
}

// --- the server test matrix, applied to the PDF maths ---

describe("PDF balancePayable matches the server derivation", () => {
  it("is the full sale price for a plain margin-scheme sale", () => {
    const c = { salePrice: 10000 };
    expect(pdfBalancePayable(c)).toBe(10000);
    expect(pdfBalancePayable(c)).toBe(serverBalancePayable(c));
  });

  it("deducts a holding deposit", () => {
    const c = { salePrice: 10000, holdingDeposit: 500 };
    expect(pdfBalancePayable(c)).toBe(9500);
    expect(pdfBalancePayable(c)).toBe(serverBalancePayable(c));
  });

  it("deducts a part-exchange allowance", () => {
    const c = { salePrice: 10000, partExchangeAllowance: 2500 };
    expect(pdfBalancePayable(c)).toBe(7500);
    expect(pdfBalancePayable(c)).toBe(serverBalancePayable(c));
  });

  it("adds sale VAT for a VAT-qualifying sale", () => {
    const c = { salePrice: 10000, saleVat: 2000 };
    expect(pdfBalancePayable(c)).toBe(12000);
    expect(pdfBalancePayable(c)).toBe(serverBalancePayable(c));
  });

  it("combines VAT, part-exchange and deposit (finance-style sale)", () => {
    // 10000 + 2000 VAT − 2500 PX − 500 deposit = 9000
    const c = {
      salePrice: 10000,
      saleVat: 2000,
      partExchangeAllowance: 2500,
      holdingDeposit: 500,
    };
    expect(pdfBalancePayable(c)).toBe(9000);
    expect(pdfBalancePayable(c)).toBe(serverBalancePayable(c));
  });

  it("excludes extras billed on a separate extras invoice", () => {
    const c = {
      salePrice: 10000,
      extras: [{ description: "Warranty", amount: 300, vat: 60 }],
      extrasOnFinanceInvoice: false,
    };
    expect(pdfBalancePayable(c)).toBe(10000);
    expect(pdfBalancePayable(c)).toBe(serverBalancePayable(c));
  });

  it("adds gross extras when billed on the finance/vehicle invoice (legacy invoice-level flag)", () => {
    const c = {
      salePrice: 10000,
      extras: [{ description: "Warranty", amount: 300, vat: 60 }],
      extrasOnFinanceInvoice: true,
    };
    expect(pdfBalancePayable(c)).toBe(10360);
    expect(pdfBalancePayable(c)).toBe(serverBalancePayable(c));
  });

  it("honours the per-item onFinanceInvoice flag over the invoice-level flag", () => {
    const c = {
      salePrice: 10000,
      extras: [
        { description: "Warranty", amount: 300, vat: 60, onFinanceInvoice: true },
        { description: "Mats", amount: 50, vat: 10, onFinanceInvoice: false },
      ],
      extrasOnFinanceInvoice: false,
    };
    // Only the warranty (300 + 60) is added.
    expect(pdfBalancePayable(c)).toBe(10360);
    expect(pdfBalancePayable(c)).toBe(serverBalancePayable(c));
  });

  it("treats a missing per-item VAT as zero", () => {
    const c = {
      salePrice: 10000,
      extras: [{ description: "Delivery", amount: 100, onFinanceInvoice: true }],
    };
    expect(pdfBalancePayable(c)).toBe(10100);
    expect(pdfBalancePayable(c)).toBe(serverBalancePayable(c));
  });

  it("rounds the derived balance to pennies", () => {
    const c = {
      salePrice: 10000.1,
      saleVat: 0.01,
      partExchangeAllowance: 0.02,
      holdingDeposit: 0.03,
      extras: [{ description: "Fee", amount: 0.1, vat: 0.02, onFinanceInvoice: true }],
      extrasOnFinanceInvoice: true,
    };
    // 10000.10 + 0.01 − 0.02 − 0.03 + 0.12 = 10000.18
    expect(pdfBalancePayable(c)).toBe(10000.18);
    expect(pdfBalancePayable(c)).toBe(serverBalancePayable(c));
  });

  it("can go negative when deductions exceed the sale price", () => {
    const c = { salePrice: 1000, partExchangeAllowance: 1500 };
    expect(pdfBalancePayable(c)).toBe(-500);
    expect(pdfBalancePayable(c)).toBe(serverBalancePayable(c));
  });
});

describe("computeInvoiceBalancePayable (sale-submission derivation)", () => {
  // The helper used when recording a sale must implement exactly the server
  // formula — check it against the reference on the whole matrix.
  const matrix: Array<Parameters<typeof computeInvoiceBalancePayable>[0]> = [
    { salePrice: 10000 },
    { salePrice: 10000, holdingDeposit: 500 },
    { salePrice: 10000, partExchangeAllowance: 2500 },
    { salePrice: 10000, saleVat: 2000 },
    {
      salePrice: 10000,
      saleVat: 2000,
      partExchangeAllowance: 2500,
      holdingDeposit: 500,
    },
    {
      salePrice: 10000,
      extras: [{ description: "Warranty", amount: 300, vat: 60 }],
      extrasOnFinanceInvoice: false,
    },
    {
      salePrice: 10000,
      extras: [{ description: "Warranty", amount: 300, vat: 60 }],
      extrasOnFinanceInvoice: true,
    },
    {
      salePrice: 10000,
      extras: [
        { description: "Warranty", amount: 300, vat: 60, onFinanceInvoice: true },
        { description: "Mats", amount: 50, vat: 10, onFinanceInvoice: false },
      ],
      extrasOnFinanceInvoice: false,
    },
    {
      salePrice: 10000,
      extras: [{ description: "Delivery", amount: 100, onFinanceInvoice: true }],
    },
    {
      salePrice: 10000.1,
      saleVat: 0.01,
      partExchangeAllowance: 0.02,
      holdingDeposit: 0.03,
      extras: [{ description: "Fee", amount: 0.1, vat: 0.02, onFinanceInvoice: true }],
      extrasOnFinanceInvoice: true,
    },
    { salePrice: 1000, partExchangeAllowance: 1500 },
  ];

  it("matches the server derivation across the full case matrix", () => {
    for (const c of matrix) {
      expect(computeInvoiceBalancePayable(c)).toBe(serverBalancePayable(c));
    }
  });

  it("also matches what the PDF would print for each case", () => {
    for (const c of matrix) {
      expect(computeInvoiceBalancePayable(c)).toBe(pdfBalancePayable(c));
    }
  });
});

// --- margin invoice generator maths ---

describe("computeMarginInvoiceTotals", () => {
  it("sums gross extras (amount + VAT) into the balance", () => {
    const out = computeMarginInvoiceTotals({
      salePrice: 10000,
      extras: [
        { description: "Warranty", amount: 300, vat: 60 },
        { description: "Delivery", amount: 100 },
      ],
    });
    expect(out.extrasGross).toBe(460);
    expect(out.balancePayable).toBe(10460);
  });

  it("handles the plain-sale case with no deductions or extras", () => {
    const out = computeMarginInvoiceTotals({ salePrice: 9995.5 });
    expect(out.extrasGross).toBe(0);
    expect(out.balancePayable).toBe(9995.5);
  });

  it("rounds penny-level arithmetic without floating point drift", () => {
    const out = computeMarginInvoiceTotals({
      salePrice: 100.1,
      partExchangeAllowance: 0.02,
      holdingDeposit: 0.03,
      extras: [{ description: "Fee", amount: 0.1, vat: 0.02 }],
    });
    expect(out.balancePayable).toBe(100.17);
  });
});

// --- VAT invoice generator maths ---

describe("computeVatInvoiceTotals", () => {
  it("shows net sale price, folds extras into net/VAT/gross", () => {
    const out = computeVatInvoiceTotals({
      salePrice: 10000,
      saleVat: 2000,
      extras: [{ description: "Warranty", amount: 300, vat: 60 }],
    });
    expect(out.extrasNet).toBe(300);
    expect(out.extrasVat).toBe(60);
    expect(out.subtotalNet).toBe(10300);
    expect(out.vatTotal).toBe(2060);
    expect(out.grossTotal).toBe(12360);
    expect(out.balancePayable).toBe(12360);
  });

  it("deducts part-exchange and deposit from the gross total", () => {
    const out = computeVatInvoiceTotals({
      salePrice: 10000,
      saleVat: 2000,
      partExchangeAllowance: 2500,
      holdingDeposit: 500,
    });
    expect(out.grossTotal).toBe(12000);
    expect(out.balancePayable).toBe(9000);
  });

  it("treats missing saleVat as zero", () => {
    const out = computeVatInvoiceTotals({ salePrice: 10000 });
    expect(out.vatTotal).toBe(0);
    expect(out.grossTotal).toBe(10000);
    expect(out.balancePayable).toBe(10000);
  });

  it("rounds every displayed figure to pennies", () => {
    const out = computeVatInvoiceTotals({
      salePrice: 10000.1,
      saleVat: 0.01,
      partExchangeAllowance: 0.02,
      holdingDeposit: 0.03,
      extras: [{ description: "Fee", amount: 0.1, vat: 0.02 }],
    });
    expect(out.subtotalNet).toBe(10000.2);
    expect(out.vatTotal).toBe(0.03);
    expect(out.grossTotal).toBe(10000.23);
    expect(out.balancePayable).toBe(10000.18);
    for (const v of [
      out.extrasNet,
      out.extrasVat,
      out.subtotalNet,
      out.vatTotal,
      out.grossTotal,
      out.balancePayable,
    ]) {
      expect(round2(v)).toBe(v);
    }
  });
});

// --- separate extras invoice maths ---

describe("computeExtrasInvoiceTotals", () => {
  it("sums net, VAT and gross across line items", () => {
    const out = computeExtrasInvoiceTotals([
      { description: "Warranty", amount: 300, vat: 60 },
      { description: "Delivery", amount: 100 },
    ]);
    expect(out.netTotal).toBe(400);
    expect(out.vatTotal).toBe(60);
    expect(out.grossTotal).toBe(460);
  });

  it("returns zeros for an empty list", () => {
    expect(computeExtrasInvoiceTotals([])).toEqual({
      netTotal: 0,
      vatTotal: 0,
      grossTotal: 0,
    });
  });

  it("rounds penny-level sums", () => {
    const out = computeExtrasInvoiceTotals([
      { description: "A", amount: 0.1, vat: 0.02 },
      { description: "B", amount: 0.2, vat: 0.01 },
    ]);
    expect(out.netTotal).toBe(0.3);
    expect(out.vatTotal).toBe(0.03);
    expect(out.grossTotal).toBe(0.33);
  });
});

// --- extras selection (finance invoice vs separate invoice) ---

describe("extras selection", () => {
  const extras: InvoiceExtraLike[] = [
    { description: "Warranty", amount: 300, vat: 60, onFinanceInvoice: true },
    { description: "Mats", amount: 50, vat: 10, onFinanceInvoice: false },
    { description: "Legacy", amount: 100 }, // no per-item flag
  ];

  it("splits per-item flagged extras, falling back to the invoice-level flag", () => {
    expect(
      selectFinanceInvoiceExtras(extras, false).map((e) => e.description),
    ).toEqual(["Warranty"]);
    expect(
      selectSeparateInvoiceExtras(extras, false).map((e) => e.description),
    ).toEqual(["Mats", "Legacy"]);
  });

  it("legacy extras follow the invoice-level flag", () => {
    expect(
      selectFinanceInvoiceExtras(extras, true).map((e) => e.description),
    ).toEqual(["Warranty", "Legacy"]);
    expect(
      selectSeparateInvoiceExtras(extras, true).map((e) => e.description),
    ).toEqual(["Mats"]);
  });

  it("every extra lands on exactly one invoice", () => {
    for (const flag of [true, false, null, undefined]) {
      const onFinance = selectFinanceInvoiceExtras(extras, flag);
      const separate = selectSeparateInvoiceExtras(extras, flag);
      expect(onFinance.length + separate.length).toBe(extras.length);
      expect(
        onFinance.filter((e) => separate.includes(e)),
      ).toEqual([]);
    }
  });

  it("handles null/undefined extras lists", () => {
    expect(selectFinanceInvoiceExtras(null, true)).toEqual([]);
    expect(selectSeparateInvoiceExtras(undefined, false)).toEqual([]);
  });
});

// --- line items & holding deposit receipt ---

describe("extraGross", () => {
  it("adds VAT to the amount", () => {
    expect(extraGross({ description: "W", amount: 300, vat: 60 })).toBe(360);
  });

  it("treats missing VAT as zero", () => {
    expect(extraGross({ description: "D", amount: 100 })).toBe(100);
  });

  it("rounds to pennies", () => {
    expect(extraGross({ description: "F", amount: 0.1, vat: 0.2 })).toBe(0.3);
  });
});

describe("computeHoldingDepositBalance", () => {
  it("is the sale price less the deposit", () => {
    expect(computeHoldingDepositBalance(10000, 500)).toBe(9500);
  });

  it("rounds to pennies", () => {
    expect(computeHoldingDepositBalance(100.1, 0.03)).toBe(100.07);
  });
});
