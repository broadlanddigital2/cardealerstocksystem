/**
 * Unit tests for the Xero CSV export builders in @workspace/report-calc.
 * The Journal export is Xero's 29-column Sales Invoice import format built as
 * a full double-entry posting (car sale + negative Car Purchases + positive
 * Stock movement, plus one Other Sales line per invoice extra); the Purchases
 * export is Xero's 26-column Bills format. These files are imported straight
 * into the client's accounting system, so a column shift, an unbalanced
 * posting, or a "0" instead of an EMPTY TaxAmount on a No-VAT line is an
 * expensive mistake.
 */
import { describe, expect, it } from "vitest";
import {
  JOURNAL_CSV_HEADERS,
  PURCHASES_CSV_HEADERS,
  buildJournalRows,
  journalLineToCsvRow,
  buildPurchasesCsvRows,
  purchaseInvoiceNo,
  csvEscape,
  toCsv,
  type SaleForJournal,
  type InvoiceForJournal,
  type PurchaseForCsv,
} from "@workspace/report-calc";

const settings = {
  vatRate: 20,
  vatQualifyingCode: "4001",
  carSalesCode: "4000",
  carPurchasesCode: "5000",
  stockCode: "1001",
  otherSalesCode: "4900",
};

function sale(overrides: Partial<SaleForJournal> = {}): SaleForJournal {
  return {
    id: 1,
    stockNumber: "STK1",
    registrationNumber: "AB12 CDE",
    make: "Ford",
    model: "Fiesta",
    vatQualifying: false,
    salePrice: 10000,
    saleVat: null,
    vatDue: 333.33,
    totalPurchaseCost: 8000,
    purchasePrice: 7800,
    saleDate: "2026-07-10",
    salesInvoiceNumber: "INV-100",
    buyerName: "Jane Buyer",
    buyerAddress: "1 High St, Town",
    ...overrides,
  };
}

const formatDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

describe("buildJournalRows", () => {
  it("posts a margin-scheme sale as a balanced 3-line double entry", () => {
    const rows = buildJournalRows([sale()], [], settings);
    expect(rows).toHaveLength(3);
    const [car, purchase, stock] = rows;

    // Car sale line to Car Sales Code with Margin Scheme tax naming
    expect(car.account).toBe("4000");
    expect(car.price).toBe(10000);
    expect(car.amount).toBe(10000);
    expect(car.taxType).toBe("Margin Scheme");
    expect(car.taxAmount).toBe(333.33);

    // Purchase cost posted NEGATIVE to Car Purchases Code as No VAT
    expect(purchase.account).toBe("5000");
    expect(purchase.amount).toBe(-8000);
    expect(purchase.taxType).toBe("No VAT");
    // EMPTY TaxAmount — not 0 — on No-VAT lines
    expect(purchase.taxAmount).toBe("");

    // Matching stock movement posted POSITIVE to Stock Code
    expect(stock.account).toBe("1001");
    expect(stock.amount).toBe(8000);
    expect(stock.taxType).toBe("No VAT");
    expect(stock.taxAmount).toBe("");

    // The purchase and stock lines cancel: only the sale amount remains
    const total = rows.reduce((t, r) => t + Number(r.amount), 0);
    expect(total).toBe(10000);

    // All lines share the invoice grouping key (ContactName + InvoiceNumber)
    for (const r of rows) {
      expect(r.contactName).toBe("Jane Buyer");
      expect(r.invoiceNumber).toBe("INV-100");
      expect(r.reference).toBe("STK1");
      expect(r.invoiceDate).toBe("2026-07-10");
    }
  });

  it("posts a VAT-qualifying sale with standard output VAT to the VAT Qualifying Code", () => {
    const rows = buildJournalRows(
      [sale({ vatQualifying: true, saleVat: 2000, vatDue: null })],
      [],
      settings,
    );
    const car = rows[0];
    expect(car.account).toBe("4001");
    expect(car.taxRate).toBe("20%");
    expect(car.taxType).toBe("20% (VAT on Income)");
    expect(car.taxAmount).toBe(2000);
  });

  it("falls back to purchasePrice when totalPurchaseCost is missing", () => {
    const rows = buildJournalRows(
      [sale({ totalPurchaseCost: null })],
      [],
      settings,
    );
    expect(rows[1].amount).toBe(-7800);
    expect(rows[2].amount).toBe(7800);
  });

  it("adds one Other Sales line per invoice extra with the right tax treatment", () => {
    const invoices: InvoiceForJournal[] = [
      {
        vehicleId: 1,
        extras: [
          { description: "Warranty", amount: 300, vat: 60 },
          { description: "Admin fee", amount: 50, vat: 0 },
        ],
      },
      // Extras on a different vehicle must not leak in
      { vehicleId: 2, extras: [{ description: "Other", amount: 10, vat: 2 }] },
    ];
    const rows = buildJournalRows([sale()], invoices, settings);
    expect(rows).toHaveLength(5);
    const [warranty, adminFee] = rows.slice(3);

    expect(warranty.description).toBe("Warranty");
    expect(warranty.account).toBe("4900");
    expect(warranty.taxType).toBe("20% (VAT on Income)");
    expect(warranty.taxAmount).toBe(60);

    // No-VAT extra: Exempt Income / No VAT — TaxAmount must be EMPTY, not 0
    expect(adminFee.taxRate).toBe("Exempt Income");
    expect(adminFee.taxType).toBe("No VAT");
    expect(adminFee.taxAmount).toBe("");

    // Invariant: EVERY No-VAT line has an empty TaxAmount
    for (const row of rows) {
      if (row.taxType === "No VAT") {
        expect(row.taxAmount).toBe("");
      }
    }
  });
});

describe("journal CSV rows", () => {
  it("has exactly 29 headers matching Xero's Sales Invoice import", () => {
    expect(JOURNAL_CSV_HEADERS).toHaveLength(29);
    expect(JOURNAL_CSV_HEADERS[0]).toBe("*ContactName");
    expect(JOURNAL_CSV_HEADERS[22]).toBe("TaxAmount");
    expect(JOURNAL_CSV_HEADERS[28]).toBe("BrandingTheme");
  });

  it("maps every line to 29 columns with values under the right headers", () => {
    const rows = buildJournalRows([sale()], [], settings);
    const csvRows = rows.map((l) => journalLineToCsvRow(l, formatDate));
    for (const row of csvRows) {
      expect(row).toHaveLength(29);
    }
    const col = (name: string) => JOURNAL_CSV_HEADERS.indexOf(name as never);
    const carRow = csvRows[0];
    expect(carRow[col("*ContactName")]).toBe("Jane Buyer");
    expect(carRow[col("*InvoiceNumber")]).toBe("INV-100");
    expect(carRow[col("Reference")]).toBe("STK1");
    expect(carRow[col("*InvoiceDate")]).toBe("10/07/2026");
    expect(carRow[col("*DueDate")]).toBe("10/07/2026");
    expect(carRow[col("*Quantity")]).toBe(1);
    expect(carRow[col("*UnitAmount")]).toBe(10000);
    expect(carRow[col("*AccountCode")]).toBe("4000");
    expect(carRow[col("*TaxType")]).toBe("Margin Scheme");
    expect(carRow[col("TaxAmount")]).toBe(333.33);
    expect(carRow[col("Currency")]).toBe("GBP");
    expect(carRow[col("POCountry")]).toBe("United Kingdom");
  });

  it("leaves TaxAmount EMPTY (not 0) on the No-VAT purchase and stock lines", () => {
    // Use a comma-free address so the serialized line can be split naively.
    const rows = buildJournalRows(
      [sale({ buyerAddress: "1 High St" })],
      [],
      settings,
    );
    const csvRows = rows.map((l) => journalLineToCsvRow(l, formatDate));
    const taxCol = JOURNAL_CSV_HEADERS.indexOf("TaxAmount" as never);
    expect(csvRows[1][taxCol]).toBe("");
    expect(csvRows[2][taxCol]).toBe("");
    // And the serialized CSV keeps the field empty
    const csv = toCsv(JOURNAL_CSV_HEADERS, csvRows);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(4); // header + 3 lines
    const purchaseCells = lines[2].split(",");
    expect(purchaseCells).toHaveLength(29);
    expect(purchaseCells[taxCol]).toBe("");
  });

  it("leaves the date blank when a sale has no date", () => {
    const rows = buildJournalRows([sale({ saleDate: null })], [], settings);
    const row = journalLineToCsvRow(rows[0], formatDate);
    expect(row[JOURNAL_CSV_HEADERS.indexOf("*InvoiceDate" as never)]).toBe("");
  });
});

describe("purchases CSV rows", () => {
  const purchase = (overrides: Partial<PurchaseForCsv> = {}): PurchaseForCsv => ({
    make: "Ford",
    model: "Fiesta",
    registrationNumber: "AB12 CDE",
    purchaseDate: "2026-07-01",
    sellerName: "Joe Seller",
    sellerAddress: "2 Low St",
    totalPurchaseCost: 8000,
    vatQualifying: false,
    purchaseVat: null,
    purchaseInvoiceNumber: null,
    purchaseNumber: "PUR00001",
    ...overrides,
  });

  it("has exactly 26 headers matching Xero's Bills import", () => {
    expect(PURCHASES_CSV_HEADERS).toHaveLength(26);
    expect(PURCHASES_CSV_HEADERS[0]).toBe("*ContactName");
    expect(PURCHASES_CSV_HEADERS[20]).toBe("TaxAmount");
    expect(PURCHASES_CSV_HEADERS[25]).toBe("Currency");
  });

  it("maps a margin-scheme purchase to 26 columns as Zero Rated with EMPTY TaxAmount", () => {
    const [row] = buildPurchasesCsvRows([purchase()], "1001", formatDate);
    expect(row).toHaveLength(26);
    const col = (name: string) => PURCHASES_CSV_HEADERS.indexOf(name as never);
    expect(row[col("*ContactName")]).toBe("Joe Seller");
    expect(row[col("*InvoiceNumber")]).toBe("PUR00001");
    expect(row[col("*InvoiceDate")]).toBe("01/07/2026");
    expect(row[col("*UnitAmount")]).toBe("8000.00");
    expect(row[col("*AccountCode")]).toBe("1001");
    expect(row[col("*TaxType")]).toBe("Zero Rated Expenses");
    expect(row[col("TaxAmount")]).toBe("");
    expect(row[col("Currency")]).toBe("GBP");
  });

  it("marks a VAT-qualifying purchase as VAT on Expenses with its input VAT", () => {
    const [row] = buildPurchasesCsvRows(
      [purchase({ vatQualifying: true, purchaseVat: 1333.33 })],
      "1001",
      formatDate,
    );
    const col = (name: string) => PURCHASES_CSV_HEADERS.indexOf(name as never);
    expect(row[col("*TaxType")]).toBe("20% (VAT on Expenses)");
    expect(row[col("TaxAmount")]).toBe("1333.33");
  });

  it("prefers the dealer's Purchase Invoice Ref over the purchase number", () => {
    expect(purchaseInvoiceNo({ purchaseInvoiceNumber: " ", purchaseNumber: "PUR00002" })).toBe("PUR00002");
    expect(purchaseInvoiceNo({ purchaseInvoiceNumber: "ABC-9", purchaseNumber: "PUR00002" })).toBe("ABC-9");
    expect(purchaseInvoiceNo({})).toBe("");
  });
});

describe("csv escaping", () => {
  it("quotes cells containing commas, quotes or newlines", () => {
    expect(csvEscape("plain")).toBe("plain");
    expect(csvEscape("1 High St, Town")).toBe('"1 High St, Town"');
    expect(csvEscape('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvEscape("a\nb")).toBe('"a\nb"');
    expect(csvEscape(null)).toBe("");
  });

  it("keeps a comma-containing buyer name in one column", () => {
    const rows = buildJournalRows(
      [sale({ buyerName: "Smith, John" })],
      [],
      settings,
    );
    const csv = toCsv(JOURNAL_CSV_HEADERS, rows.map((l) => journalLineToCsvRow(l, formatDate)));
    expect(csv).toContain('"Smith, John"');
    // Parsing the first data line naively on unquoted commas would break; the
    // quoted cell keeps the 29-column shape intact.
    const firstDataLine = csv.split("\n")[1];
    const naiveCells = firstDataLine.split(",");
    expect(naiveCells.length).toBeGreaterThan(29); // proves the quote is doing work
  });
});
