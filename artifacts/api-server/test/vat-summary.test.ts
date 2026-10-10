/**
 * Unit tests for the dashboard VAT box computations in
 * @workspace/report-calc. These aggregates (output VAT − input VAT,
 * attributed by date to the month and the dealer's VAT period) feed
 * directly into the client's VAT return, so a subtle date-attribution
 * mistake here is expensive and hard to spot.
 *
 * Rules under test:
 * - Margin-scheme sales contribute margin VAT (one-sixth of a positive margin)
 * - VAT-qualifying sales contribute their separate output VAT (saleVat) and
 *   NO margin VAT
 * - VAT-qualifying purchases contribute reclaimable input VAT, attributed to
 *   the purchase date's period, netted off the headline figures
 * - Invoice extras VAT is attributed to the invoice date's period
 * - Month vs VAT-quarter attribution follows the dealer's stagger setting
 */
import { describe, expect, it } from "vitest";
import {
  computeDashboardSummary,
  vatPeriodRange,
  type VehicleForSummary,
  type InvoiceForSummary,
} from "@workspace/report-calc";

let nextId = 1;
function vehicle(overrides: Partial<VehicleForSummary>): VehicleForSummary {
  const id = nextId++;
  return {
    id,
    stockNumber: `STK${id}`,
    registrationNumber: `REG${id}`,
    make: "Ford",
    model: "Fiesta",
    status: "in_stock",
    purchaseDate: "2026-07-01",
    saleDate: null,
    purchasePrice: 5000,
    auctionCostNoVat: null,
    vatQualifying: false,
    purchaseVat: null,
    saleVat: null,
    salePrice: null,
    ...overrides,
  };
}

// A fixed "now" of 15 July 2026. With the default Stagger 1 setting the VAT
// quarter is Jul–Sep 2026; the month is July 2026.
const NOW = new Date(2026, 6, 15);

const summarize = (
  vehicles: VehicleForSummary[],
  invoices: InvoiceForSummary[] = [],
  vatQuarter: string | null = null,
) => computeDashboardSummary(vehicles, invoices, NOW, vatQuarter);

describe("vatPeriodRange", () => {
  it("defaults to stagger 1 calendar quarters", () => {
    const r = vatPeriodRange(NOW, null);
    expect(r.startStr).toBe("2026-07-01");
    expect(r.endExclusiveStr).toBe("2026-10-01");
    expect(r.label).toBe("Jul–Sep 2026");
  });

  it("shifts quarter boundaries for stagger 2 and stagger 3", () => {
    // Stagger 2: Feb–Apr, May–Jul, Aug–Oct, Nov–Jan. July falls in May–Jul.
    const s2 = vatPeriodRange(NOW, "stagger_2");
    expect(s2.startStr).toBe("2026-05-01");
    expect(s2.endExclusiveStr).toBe("2026-08-01");
    // Stagger 3: Mar–May, Jun–Aug, Sep–Nov, Dec–Feb. July falls in Jun–Aug.
    const s3 = vatPeriodRange(NOW, "stagger_3");
    expect(s3.startStr).toBe("2026-06-01");
    expect(s3.endExclusiveStr).toBe("2026-09-01");
  });

  it("handles a stagger period spanning a year end", () => {
    // Stagger 2 in January 2026 → Nov 2025 – Jan 2026.
    const r = vatPeriodRange(new Date(2026, 0, 10), "stagger_2");
    expect(r.startStr).toBe("2025-11-01");
    expect(r.endExclusiveStr).toBe("2026-02-01");
    expect(r.label).toBe("Nov 2025 – Jan 2026");
  });

  it("supports monthly and annual periods", () => {
    const m = vatPeriodRange(NOW, "monthly");
    expect(m.startStr).toBe("2026-07-01");
    expect(m.endExclusiveStr).toBe("2026-08-01");
    expect(m.label).toBe("Jul 2026");
    const a = vatPeriodRange(NOW, "annual");
    expect(a.startStr).toBe("2026-01-01");
    expect(a.endExclusiveStr).toBe("2027-01-01");
  });
});

describe("VAT box totals: output VAT − input VAT", () => {
  it("charges margin VAT (one-sixth) on a margin-scheme sale", () => {
    // Bought £8,000, sold £10,000 → margin £2,000 → VAT £333.33
    const s = summarize([
      vehicle({
        status: "sold",
        purchaseDate: "2026-06-01",
        saleDate: "2026-07-10",
        purchasePrice: 8000,
        salePrice: 10000,
      }),
    ]);
    expect(s.vatDueThisMonth).toBe(333.33);
    expect(s.vatDueThisQuarter).toBe(333.33);
  });

  it("includes no-VAT auction fees in the margin cost basis", () => {
    // £8,000 + £400 fees, sold £10,000 → margin £1,600 → VAT £266.67
    const s = summarize([
      vehicle({
        status: "sold",
        purchaseDate: "2026-06-01",
        saleDate: "2026-07-10",
        purchasePrice: 8000,
        auctionCostNoVat: 400,
        salePrice: 10000,
      }),
    ]);
    expect(s.vatDueThisMonth).toBe(266.67);
  });

  it("charges no VAT on a loss-making margin sale", () => {
    const s = summarize([
      vehicle({
        status: "sold",
        purchaseDate: "2026-06-01",
        saleDate: "2026-07-10",
        purchasePrice: 10000,
        salePrice: 9000,
      }),
    ]);
    expect(s.vatDueThisMonth).toBe(0);
    expect(s.vatThisMonthDetail).toHaveLength(0);
  });

  it("uses saleVat (not margin VAT) for a VAT-qualifying sale", () => {
    // VAT-qualifying: standard-rated, output VAT £2,000; margin scheme must NOT apply.
    const s = summarize([
      vehicle({
        status: "sold",
        vatQualifying: true,
        purchaseDate: "2026-06-01",
        saleDate: "2026-07-10",
        purchasePrice: 8000,
        salePrice: 10000,
        saleVat: 2000,
      }),
    ]);
    expect(s.vatDueThisMonth).toBe(2000);
    // Net margin box excludes margin VAT only; VAT-qualifying margin isn't reduced.
    expect(s.vatThisMonthDetail).toEqual([
      expect.objectContaining({
        label: "Output VAT (VAT-qualifying sale)",
        amount: 2000,
      }),
    ]);
  });

  it("nets input VAT on a VAT-qualifying purchase off the headline figure", () => {
    const s = summarize([
      // Margin sale contributing £333.33 output VAT in July
      vehicle({
        status: "sold",
        purchaseDate: "2026-06-01",
        saleDate: "2026-07-10",
        purchasePrice: 8000,
        salePrice: 10000,
      }),
      // VAT-qualifying purchase in July with £1,000 reclaimable input VAT
      vehicle({
        vatQualifying: true,
        purchaseDate: "2026-07-05",
        purchasePrice: 6000,
        purchaseVat: 1000,
      }),
    ]);
    expect(s.vatDueThisMonth).toBe(-666.67);
    expect(s.vatDueThisQuarter).toBe(-666.67);
    // The breakdown lists input VAT as a negative line so it sums to the headline.
    const sum = s.vatThisMonthDetail.reduce((t, d) => t + d.amount, 0);
    expect(Math.round(sum * 100) / 100).toBe(s.vatDueThisMonth);
  });

  it("ignores purchaseVat on non-VAT-qualifying purchases", () => {
    const s = summarize([
      vehicle({
        vatQualifying: false,
        purchaseDate: "2026-07-05",
        purchasePrice: 6000,
        purchaseVat: 1000, // stray data — must not be reclaimed
      }),
    ]);
    expect(s.vatDueThisMonth).toBe(0);
    expect(s.vatDueThisQuarter).toBe(0);
  });
});

describe("date attribution across periods", () => {
  it("attributes a sale in the quarter but not the month only to the quarter", () => {
    // Sold 20 Aug 2026: inside Jul–Sep quarter, outside July.
    const s = summarize([
      vehicle({
        status: "sold",
        purchaseDate: "2026-06-01",
        saleDate: "2026-08-20",
        purchasePrice: 8000,
        salePrice: 10000,
      }),
    ]);
    expect(s.vatDueThisMonth).toBe(0);
    expect(s.vatDueThisQuarter).toBe(333.33);
    expect(s.vatThisMonthDetail).toHaveLength(0);
    expect(s.vatThisQuarterDetail).toHaveLength(1);
  });

  it("excludes sales dated before the current quarter", () => {
    const s = summarize([
      vehicle({
        status: "sold",
        purchaseDate: "2026-01-01",
        saleDate: "2026-06-30", // last day of the previous quarter
        purchasePrice: 8000,
        salePrice: 10000,
      }),
    ]);
    expect(s.vatDueThisMonth).toBe(0);
    expect(s.vatDueThisQuarter).toBe(0);
  });

  it("attributes input VAT by PURCHASE date even when sold in a later period", () => {
    // Purchased in June (previous quarter under stagger 1... June IS outside
    // Jul–Sep), sold in July. Input VAT belongs to June, not July.
    const s = summarize([
      vehicle({
        status: "sold",
        vatQualifying: true,
        purchaseDate: "2026-06-15",
        saleDate: "2026-07-10",
        purchasePrice: 6000,
        purchaseVat: 1000,
        salePrice: 9000,
        saleVat: 1800,
      }),
    ]);
    // July: output VAT £1,800 only — the June input VAT must NOT be netted off.
    expect(s.vatDueThisMonth).toBe(1800);
    expect(s.vatDueThisQuarter).toBe(1800);
  });

  it("respects the dealer's stagger setting for quarter attribution", () => {
    // Sale on 10 May 2026. Under stagger 2 (May–Jul), it's in the current
    // quarter; under stagger 1 (Jul–Sep) it is not.
    const sale = vehicle({
      status: "sold",
      purchaseDate: "2026-04-01",
      saleDate: "2026-05-10",
      purchasePrice: 8000,
      salePrice: 10000,
    });
    expect(summarize([sale], [], "stagger_2").vatDueThisQuarter).toBe(333.33);
    expect(summarize([sale], [], null).vatDueThisQuarter).toBe(0);
    // Monthly period: May sale is outside July's monthly period.
    expect(summarize([sale], [], "monthly").vatDueThisQuarter).toBe(0);
    // Annual period: inside 2026.
    expect(summarize([sale], [], "annual").vatDueThisQuarter).toBe(333.33);
  });

  it("attributes invoice extras VAT to the invoice date's period", () => {
    const invoices: InvoiceForSummary[] = [
      // July invoice: £50 extras VAT counts in month + quarter
      { invoiceNumber: "INV-1", invoiceDate: "2026-07-03", extras: [{ vat: 30 }, { vat: 20 }] },
      // August invoice: quarter only
      { invoiceNumber: "INV-2", invoiceDate: "2026-08-03", extras: [{ vat: 10 }] },
      // June invoice: neither
      { invoiceNumber: "INV-3", invoiceDate: "2026-06-03", extras: [{ vat: 99 }] },
      // Extras without VAT contribute nothing
      { invoiceNumber: "INV-4", invoiceDate: "2026-07-04", extras: [{}, { vat: 0 }] },
    ];
    const s = summarize([], invoices);
    expect(s.vatDueThisMonth).toBe(50);
    expect(s.vatDueThisQuarter).toBe(60);
    expect(s.standardVatThisQuarter).toBe(60);
  });
});

describe("headline totals and breakdown consistency", () => {
  it("computes sales/margin/net-margin boxes and keeps details summing to headlines", () => {
    const s = summarize(
      [
        vehicle({
          status: "sold",
          purchaseDate: "2026-06-01",
          saleDate: "2026-07-10",
          purchasePrice: 8000,
          salePrice: 10000,
        }),
        vehicle({
          status: "sold",
          vatQualifying: true,
          purchaseDate: "2026-07-02",
          saleDate: "2026-07-12",
          purchasePrice: 6000,
          purchaseVat: 1000,
          salePrice: 9000,
          saleVat: 1800,
        }),
        vehicle({ status: "in_stock", purchasePrice: 4000, auctionCostNoVat: 250 }),
      ],
      [{ invoiceNumber: "INV-9", invoiceDate: "2026-07-20", extras: [{ vat: 40 }] }],
    );
    expect(s.soldThisMonthCount).toBe(2);
    expect(s.totalSalesThisMonth).toBe(19000);
    // Margins: 2000 (margin sale) + 3000 (VAT-qualifying, margin box still shows sale − cost)
    expect(s.totalMarginThisMonth).toBe(5000);
    // Net margin removes only margin-scheme VAT (333.33)
    expect(s.netMarginThisMonth).toBe(4666.67);
    // VAT: 333.33 margin + 1800 output + 40 extras − 1000 input = 1173.33
    expect(s.vatDueThisMonth).toBe(1173.33);
    const sum = s.vatThisMonthDetail.reduce((t, d) => t + d.amount, 0);
    expect(Math.round(sum * 100) / 100).toBe(s.vatDueThisMonth);
    // Stock boxes
    expect(s.inStockCount).toBe(1);
    expect(s.totalStockValue).toBe(4250);
  });

  it("accepts numeric-string money values as stored by the database", () => {
    const s = summarize([
      vehicle({
        status: "sold",
        purchaseDate: "2026-07-01",
        saleDate: "2026-07-10",
        purchasePrice: "8000.00",
        salePrice: "10000.00",
      }),
    ]);
    expect(s.vatDueThisMonth).toBe(333.33);
    expect(s.totalSalesThisMonth).toBe(10000);
  });
});
