/**
 * Cross-check tests: the dashboard VAT boxes (computeDashboardSummary) and
 * the Xero exports (buildJournalRows / buildPurchasesCsvRows) are computed by
 * separate pure helpers, and each has its own unit tests — but nothing else
 * verifies they AGREE with each other for the same period. An accountant
 * would only spot a divergence at VAT-return time, so these tests build ONE
 * shared fixture set of vehicles and invoices, feed it to both surfaces, and
 * assert:
 *
 * - sum of the Journal export's numeric TaxAmounts (car lines + extras lines)
 *   for the VAT period == the dashboard summary's output VAT component
 * - sum of the Purchases (Bills) export's numeric TaxAmounts for the period
 *   == the dashboard summary's input VAT component
 * - dashboard headline VAT due == Journal output VAT − Purchases input VAT
 *
 * If a change to one surface (e.g. a new VAT source, a changed attribution
 * rule, or a rounding tweak) is not mirrored in the other, these tests fail.
 */
import { describe, expect, it } from "vitest";
import {
  buildJournalRows,
  buildPurchasesCsvRows,
  computeDashboardSummary,
  computeMargins,
  journalLineToCsvRow,
  round2,
  vatPeriodRange,
  JOURNAL_CSV_HEADERS,
  PURCHASES_CSV_HEADERS,
  type InvoiceForJournal,
  type InvoiceForSummary,
  type JournalSettings,
  type PurchaseForCsv,
  type SaleForJournal,
  type VehicleForSummary,
} from "@workspace/report-calc";

// A fixed "now" of 15 July 2026; default Stagger 1 → VAT quarter Jul–Sep 2026.
const NOW = new Date(2026, 6, 15);
const QUARTER = vatPeriodRange(NOW, null);

const settings: JournalSettings = {
  vatRate: 20,
  vatQualifyingCode: "4001",
  carSalesCode: "4000",
  carPurchasesCode: "5000",
  stockCode: "1001",
  otherSalesCode: "4900",
};

/**
 * ONE canonical fixture record per vehicle. Both the dashboard input shape
 * and the Xero export input shapes are DERIVED from these records (below),
 * so the two surfaces are guaranteed to be looking at the same underlying
 * business data — exactly as in production, where both read the same DB rows.
 */
type FixtureVehicle = {
  id: number;
  stockNumber: string;
  registrationNumber: string;
  make: string;
  model: string;
  status: "in_stock" | "sold";
  purchaseDate: string;
  saleDate: string | null;
  purchasePrice: number;
  auctionCostNoVat: number | null;
  vatQualifying: boolean;
  purchaseVat: number | null;
  salePrice: number | null;
  saleVat: number | null;
  sellerName: string;
  buyerName: string | null;
  extras: Array<{ description: string; amount: number; vat: number | null }>;
};

const FIXTURES: FixtureVehicle[] = [
  {
    // Margin-scheme sale in the quarter, positive margin (with a no-VAT
    // auction fee folded into the cost): margin = 10000 − 8200 = 1800,
    // margin VAT = 300. Extras: £120 delivery carrying £20 VAT.
    id: 1,
    stockNumber: "STK1",
    registrationNumber: "AB12 CDE",
    make: "Ford",
    model: "Fiesta",
    status: "sold",
    purchaseDate: "2026-06-01",
    saleDate: "2026-07-10",
    purchasePrice: 8000,
    auctionCostNoVat: 200,
    vatQualifying: false,
    purchaseVat: null,
    salePrice: 10000,
    saleVat: null,
    sellerName: "Auction House",
    buyerName: "Jane Buyer",
    extras: [{ description: "Delivery", amount: 120, vat: 20 }],
  },
  {
    // Margin-scheme sale in the quarter at a LOSS: margin VAT must be £0 on
    // both surfaces. Purchased inside the quarter but not VAT-qualifying, so
    // it contributes no input VAT (and an EMPTY Bills TaxAmount).
    id: 2,
    stockNumber: "STK2",
    registrationNumber: "BC12 DEF",
    make: "Vauxhall",
    model: "Corsa",
    status: "sold",
    purchaseDate: "2026-07-05",
    saleDate: "2026-08-05",
    purchasePrice: 6000,
    auctionCostNoVat: null,
    vatQualifying: false,
    purchaseVat: null,
    salePrice: 5500,
    saleVat: null,
    sellerName: "Private Seller",
    buyerName: "Bob Buyer",
    extras: [],
  },
  {
    // VAT-qualifying sale in the quarter: standard output VAT (saleVat 3000),
    // NO margin VAT, and reclaimable input VAT (2400) attributed to its
    // in-quarter purchase date. Extras: one VATable, one zero-VAT (the
    // zero-VAT extra must contribute nothing on either surface).
    id: 3,
    stockNumber: "STK3",
    registrationNumber: "CD12 EFG",
    make: "BMW",
    model: "320d",
    status: "sold",
    purchaseDate: "2026-07-03",
    saleDate: "2026-09-20",
    purchasePrice: 12000,
    auctionCostNoVat: null,
    vatQualifying: true,
    purchaseVat: 2400,
    salePrice: 15000,
    saleVat: 3000,
    sellerName: "Trade Supplier Ltd",
    buyerName: "Carol Buyer",
    extras: [
      { description: "Warranty", amount: 300, vat: 50 },
      { description: "Admin fee", amount: 25, vat: 0 },
    ],
  },
  {
    // Margin-scheme sale with a margin that does NOT divide evenly by six
    // (margin 1000 → VAT 166.67): exercises rounding agreement.
    id: 4,
    stockNumber: "STK4",
    registrationNumber: "DE12 FGH",
    make: "Toyota",
    model: "Yaris",
    status: "sold",
    purchaseDate: "2026-05-20",
    saleDate: "2026-07-20",
    purchasePrice: 4000,
    auctionCostNoVat: null,
    vatQualifying: false,
    purchaseVat: null,
    salePrice: 5000,
    saleVat: null,
    sellerName: "Auction House",
    buyerName: "Dan Buyer",
    extras: [],
  },
  {
    // Sold BEFORE the quarter — must be excluded from both the quarter
    // dashboard figures and the period-filtered Journal export.
    id: 5,
    stockNumber: "STK5",
    registrationNumber: "EF12 GHI",
    make: "Honda",
    model: "Civic",
    status: "sold",
    purchaseDate: "2026-04-01",
    saleDate: "2026-06-15",
    purchasePrice: 7000,
    auctionCostNoVat: null,
    vatQualifying: false,
    purchaseVat: null,
    salePrice: 9100,
    saleVat: null,
    sellerName: "Private Seller",
    buyerName: "Eve Buyer",
    extras: [{ description: "Delivery", amount: 100, vat: 16.67 }],
  },
  {
    // Still in stock, VAT-qualifying, purchased inside the quarter: its input
    // VAT (400) appears on the dashboard AND in the Purchases export even
    // though there is no sale yet.
    id: 6,
    stockNumber: "STK6",
    registrationNumber: "FG12 HIJ",
    make: "Audi",
    model: "A3",
    status: "in_stock",
    purchaseDate: "2026-08-01",
    purchasePrice: 2000,
    auctionCostNoVat: null,
    vatQualifying: true,
    purchaseVat: 400,
    saleDate: null,
    salePrice: null,
    saleVat: null,
    sellerName: "Trade Supplier Ltd",
    buyerName: null,
    extras: [],
  },
];

const totalPurchaseCost = (f: FixtureVehicle) =>
  f.purchasePrice + (f.auctionCostNoVat ?? 0);

// ---- Derive the dashboard inputs from the shared fixtures ----

const dashboardVehicles: VehicleForSummary[] = FIXTURES.map((f) => ({
  id: f.id,
  stockNumber: f.stockNumber,
  registrationNumber: f.registrationNumber,
  make: f.make,
  model: f.model,
  status: f.status,
  purchaseDate: f.purchaseDate,
  saleDate: f.saleDate,
  purchasePrice: f.purchasePrice,
  auctionCostNoVat: f.auctionCostNoVat,
  vatQualifying: f.vatQualifying,
  purchaseVat: f.purchaseVat,
  saleVat: f.saleVat,
  salePrice: f.salePrice,
}));

// One invoice per sold vehicle, dated on the sale date (as the app creates
// them when a sale is recorded), carrying that vehicle's extras.
const dashboardInvoices: InvoiceForSummary[] = FIXTURES.filter(
  (f) => f.status === "sold" && f.saleDate,
).map((f) => ({
  invoiceNumber: `INV-${100 + f.id}`,
  invoiceDate: f.saleDate!,
  extras: f.extras.map((e) => ({ vat: e.vat })),
}));

// ---- Derive the Xero export inputs from the SAME fixtures ----

// The Journal export covers sales in the selected period. vatDue is derived
// with computeMargins exactly as the server's vehicle serializer derives it.
const journalSales: SaleForJournal[] = FIXTURES.filter(
  (f) =>
    f.status === "sold" &&
    f.saleDate != null &&
    f.saleDate >= QUARTER.startStr &&
    f.saleDate < QUARTER.endExclusiveStr,
).map((f) => ({
  id: f.id,
  stockNumber: f.stockNumber,
  registrationNumber: f.registrationNumber,
  make: f.make,
  model: f.model,
  vatQualifying: f.vatQualifying,
  salePrice: f.salePrice,
  saleVat: f.saleVat,
  vatDue: f.vatQualifying
    ? 0
    : computeMargins(totalPurchaseCost(f), f.salePrice).vatDue,
  totalPurchaseCost: totalPurchaseCost(f),
  purchasePrice: f.purchasePrice,
  saleDate: f.saleDate,
  salesInvoiceNumber: `INV-${100 + f.id}`,
  buyerName: f.buyerName,
  buyerAddress: "1 High St, Town",
}));

const journalInvoices: InvoiceForJournal[] = FIXTURES.map((f) => ({
  vehicleId: f.id,
  extras: f.extras,
}));

// The Purchases (Bills) export covers purchases in the selected period.
const purchasesInPeriod: PurchaseForCsv[] = FIXTURES.filter(
  (f) =>
    f.purchaseDate >= QUARTER.startStr &&
    f.purchaseDate < QUARTER.endExclusiveStr,
).map((f) => ({
  make: f.make,
  model: f.model,
  registrationNumber: f.registrationNumber,
  purchaseDate: f.purchaseDate,
  sellerName: f.sellerName,
  totalPurchaseCost: totalPurchaseCost(f),
  vatQualifying: f.vatQualifying,
  purchaseVat: f.purchaseVat,
  purchaseNumber: `PUR0000${f.id}`,
}));

const formatDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

const numericSum = (values: unknown[]) =>
  round2(
    values.reduce<number>((sum, v) => {
      if (v === "" || v == null) return sum;
      const n = Number(v);
      return Number.isFinite(n) ? sum + n : sum;
    }, 0),
  );

describe("dashboard VAT boxes vs Xero exports (same period, same fixtures)", () => {
  const summary = computeDashboardSummary(
    dashboardVehicles,
    dashboardInvoices,
    NOW,
    null,
  );

  // The dashboard's quarter VAT breakdown lists output VAT as positive
  // amounts and reclaimed input VAT as negative amounts, and the list sums
  // to the headline figure. Split it into its two components.
  const dashboardOutputVat = round2(
    summary.vatThisQuarterDetail
      .filter((d) => d.amount > 0)
      .reduce((s, d) => s + d.amount, 0),
  );
  const dashboardInputVat = round2(
    summary.vatThisQuarterDetail
      .filter((d) => d.amount < 0)
      .reduce((s, d) => s - d.amount, 0),
  );

  const journalRows = buildJournalRows(journalSales, journalInvoices, settings);

  it("fixture sanity: the quarter has margin, VAT-qualifying, loss-making and out-of-period records", () => {
    // Guards against the fixture set degenerating into a trivial case where
    // the reconciliation below would pass vacuously.
    expect(journalSales.map((s) => s.id).sort()).toEqual([1, 2, 3, 4]);
    expect(purchasesInPeriod.length).toBe(3); // STK2, STK3, STK6
    expect(dashboardOutputVat).toBeGreaterThan(0);
    expect(dashboardInputVat).toBeGreaterThan(0);
  });

  it("Journal export output VAT reconciles with the dashboard's quarter output VAT", () => {
    // Every VAT-carrying Journal line: car lines carry margin VAT or standard
    // output VAT; extras lines carry extras VAT; purchase/stock movement
    // lines carry an EMPTY TaxAmount and must contribute nothing.
    const journalOutputVat = numericSum(journalRows.map((r) => r.taxAmount));
    expect(journalOutputVat).toBe(dashboardOutputVat);
    // Expected: 300 (STK1 margin) + 0 (STK2 loss) + 3000 (STK3 saleVat)
    // + 166.67 (STK4 margin) + 20 + 50 + 0 (extras) = 3536.67
    expect(journalOutputVat).toBe(3536.67);
  });

  it("Purchases export input VAT reconciles with the dashboard's quarter input VAT", () => {
    const csvRows = buildPurchasesCsvRows(
      purchasesInPeriod,
      "1001",
      formatDate,
    );
    const taxCol = PURCHASES_CSV_HEADERS.indexOf("TaxAmount");
    const purchasesInputVat = numericSum(csvRows.map((r) => r[taxCol]));
    expect(purchasesInputVat).toBe(dashboardInputVat);
    // Expected: 2400 (STK3) + 400 (STK6); STK2 is margin-scheme → empty.
    expect(purchasesInputVat).toBe(2800);
  });

  it("dashboard headline VAT due for the quarter == Journal output VAT − Purchases input VAT", () => {
    const journalOutputVat = numericSum(journalRows.map((r) => r.taxAmount));
    const csvRows = buildPurchasesCsvRows(
      purchasesInPeriod,
      "1001",
      formatDate,
    );
    const taxCol = PURCHASES_CSV_HEADERS.indexOf("TaxAmount");
    const purchasesInputVat = numericSum(csvRows.map((r) => r[taxCol]));
    expect(round2(journalOutputVat - purchasesInputVat)).toBe(
      summary.vatDueThisQuarter,
    );
    expect(summary.vatDueThisQuarter).toBe(736.67);
  });

  it("the reconciliation survives the CSV serialisation round-trip", () => {
    // Re-derive the Journal output VAT from the actual 29-column CSV rows
    // (not the intermediate JournalLine objects) so a column reshuffle that
    // moves TaxAmount would also be caught.
    const taxCol = JOURNAL_CSV_HEADERS.indexOf("TaxAmount");
    const csvTax = journalRows.map(
      (l) => journalLineToCsvRow(l, formatDate)[taxCol],
    );
    expect(numericSum(csvTax)).toBe(dashboardOutputVat);
  });
});
