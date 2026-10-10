/**
 * Xero CSV export builders. Extracted from the Reports page so the row/column
 * generation that feeds directly into the client's accounting system can be
 * unit-tested.
 *
 * The Journal export uses Xero's 29-column Sales Invoice import format; the
 * Purchases export uses Xero's 26-column Bills import format. No-VAT lines
 * must carry an EMPTY TaxAmount (not 0), and lines are grouped into one Xero
 * invoice by ContactName + InvoiceNumber.
 */

/** Xero Sales Invoice import headers (29 columns). */
export const JOURNAL_CSV_HEADERS = [
  "*ContactName", "EmailAddress", "POAddressLine1", "POAddressLine2",
  "POAddressLine3", "POAddressLine4", "POCity", "PORegion", "POPostalCode",
  "POCountry", "*InvoiceNumber", "Reference", "*InvoiceDate", "*DueDate",
  "Total", "InventoryItemCode", "*Description", "*Quantity", "*UnitAmount",
  "Discount", "*AccountCode", "*TaxType", "TaxAmount", "TrackingName1",
  "TrackingOption1", "TrackingName2", "TrackingOption2", "Currency",
  "BrandingTheme",
] as const;

/** Xero Bills (purchases) import headers (26 columns). */
export const PURCHASES_CSV_HEADERS = [
  "*ContactName", "EmailAddress", "POAddressLine1", "POAddressLine2",
  "POAddressLine3", "POAddressLine4", "POCity", "PORegion", "POPostalCode",
  "POCountry", "*InvoiceNumber", "*InvoiceDate", "*DueDate", "Total",
  "InventoryItemCode", "Description", "*Quantity", "*UnitAmount",
  "*AccountCode", "*TaxType", "TaxAmount", "TrackingName1", "TrackingOption1",
  "TrackingName2", "TrackingOption2", "Currency",
] as const;

export type JournalLine = {
  contactName: string;
  address: string;
  reference: string;
  invoiceNumber: string;
  invoiceDate: string;
  description: string;
  qty: number | string;
  price: number | string;
  account: string;
  taxRate: string;
  taxType: string;
  taxAmount: number | string;
  amount: number | string;
};

export type SaleForJournal = {
  id: number;
  stockNumber: string;
  registrationNumber: string;
  make: string;
  model: string;
  vatQualifying?: boolean | null;
  salePrice?: number | null;
  saleVat?: number | null;
  vatDue?: number | null;
  totalPurchaseCost?: number | null;
  purchasePrice?: number | null;
  saleDate?: string | null;
  salesInvoiceNumber?: string | null;
  buyerName?: string | null;
  buyerAddress?: string | null;
};

export type InvoiceForJournal = {
  vehicleId: number;
  extras?: Array<{
    description: string;
    amount: number;
    vat?: number | null;
  }> | null;
};

export type JournalSettings = {
  vatRate?: number | string | null;
  vatQualifyingCode?: string | null;
  carSalesCode?: string | null;
  carPurchasesCode?: string | null;
  stockCode?: string | null;
  otherSalesCode?: string | null;
};

/**
 * Journal postings. When a car is sold, post a line for the car sale amount
 * (Account = Car Sales Code, or VAT Qualifying Code for a VAT-qualifying sale),
 * a matching negative Car Purchases line and a positive Stock movement line
 * (both No VAT, empty TaxAmount), plus one Other Sales line per invoice extra.
 * VAT-qualifying sales carry standard VAT; margin-scheme sales do not charge
 * VAT separately. Tax names map to Xero's default UK tax-rate names so the
 * CSV imports cleanly (the dealer must ensure these names match their org).
 */
export function buildJournalRows(
  sales: SaleForJournal[],
  invoices: InvoiceForJournal[],
  settings: JournalSettings | null | undefined,
): JournalLine[] {
  const incomeTax = (vatable: boolean) =>
    vatable ? "20% (VAT on Income)" : "No VAT";
  return sales.flatMap((v) => {
    const vatRateLabel = settings?.vatRate ? `${settings.vatRate}%` : "";
    const account = v.vatQualifying
      ? (settings?.vatQualifyingCode ?? "")
      : (settings?.carSalesCode ?? "");
    const price = v.salePrice ?? 0;
    // Fields shared by every line of this vehicle's invoice. Grouping lines by
    // ContactName + InvoiceNumber is what makes Xero treat them as one invoice.
    const header = {
      contactName: v.buyerName ?? "",
      address: v.buyerAddress ?? "",
      reference: v.stockNumber,
      invoiceNumber: v.salesInvoiceNumber ?? "",
      invoiceDate: v.saleDate ?? "",
    };
    const carLine: JournalLine = {
      ...header,
      description: `${v.make} ${v.model} (${v.registrationNumber})`,
      qty: 1,
      price,
      account,
      taxRate: v.vatQualifying ? vatRateLabel : "Margin Scheme",
      taxType: v.vatQualifying ? "20% (VAT on Income)" : "Margin Scheme",
      taxAmount: v.vatQualifying ? (v.saleVat ?? 0) : (v.vatDue ?? 0),
      amount: price,
    };
    // The cost that backs the sale is always the total purchase cost (net
    // purchase price plus any no-VAT auction fees). The Car Purchases and Stock
    // lines are always posted as No VAT with no tax amount. Posted as a negative.
    const purchaseCost = v.totalPurchaseCost ?? v.purchasePrice ?? 0;
    const purchaseLine: JournalLine = {
      ...header,
      description: `${v.make} ${v.model} (${v.registrationNumber})`,
      qty: 1,
      price: -purchaseCost,
      account: settings?.carPurchasesCode ?? "",
      taxRate: "No VAT",
      taxType: "No VAT",
      taxAmount: "",
      amount: -purchaseCost,
    };
    // The matching stock movement: same as the purchase line but posted to the
    // Stock Code as a positive figure (the cost moving into stock on sale).
    const stockLine: JournalLine = {
      ...header,
      description: `${v.make} ${v.model} (${v.registrationNumber})`,
      qty: 1,
      price: purchaseCost,
      account: settings?.stockCode ?? "",
      taxRate: "No VAT",
      taxType: "No VAT",
      taxAmount: "",
      amount: purchaseCost,
    };
    const inv = invoices.find((i) => i.vehicleId === v.id);
    const extraLines: JournalLine[] = (inv?.extras ?? []).map((ex) => ({
      ...header,
      description: ex.description,
      qty: 1,
      price: ex.amount,
      account: settings?.otherSalesCode ?? "",
      taxRate: (ex.vat ?? 0) > 0 ? vatRateLabel : "Exempt Income",
      taxType: incomeTax((ex.vat ?? 0) > 0),
      taxAmount: (ex.vat ?? 0) > 0 ? (ex.vat as number) : "",
      amount: ex.amount,
    }));
    return [carLine, purchaseLine, stockLine, ...extraLines];
  });
}

/**
 * Map a journal line to its 29-column Xero Sales Invoice CSV row. `formatDate`
 * renders "YYYY-MM-DD" as the dealer-facing "DD/MM/YYYY".
 */
export function journalLineToCsvRow(
  l: JournalLine,
  formatDate: (iso: string) => string,
): unknown[] {
  const d = l.invoiceDate ? formatDate(l.invoiceDate) : "";
  return [
    l.contactName, "", l.address, "", "", "", "", "", "", "United Kingdom",
    l.invoiceNumber, l.reference, d, d,
    "", "", l.description, l.qty, l.price, "", l.account, l.taxType,
    l.taxAmount, "", "", "", "", "GBP", "",
  ];
}

export type PurchaseForCsv = {
  make: string;
  model: string;
  registrationNumber: string;
  purchaseDate: string;
  sellerName?: string | null;
  sellerAddress?: string | null;
  totalPurchaseCost: number;
  vatQualifying?: boolean | null;
  purchaseVat?: number | null;
  purchaseInvoiceNumber?: string | null;
  purchaseNumber?: string | null;
};

/**
 * Each purchase's Xero Bill invoice number is the dealer's Purchase Invoice
 * Ref when set, otherwise the durable, server-allocated purchase number
 * (PUR00001…) which is unique per dealer and assigned once at creation.
 */
export function purchaseInvoiceNo(v: {
  purchaseInvoiceNumber?: string | null;
  purchaseNumber?: string | null;
}): string {
  return v.purchaseInvoiceNumber?.trim() || v.purchaseNumber || "";
}

/**
 * Map purchases to their 26-column Xero Bills CSV rows, one line per vehicle
 * posted to the Stock Code. VAT-qualifying purchases carry input VAT
 * ("20% (VAT on Expenses)"); margin-scheme purchases are Zero Rated Expenses
 * with an EMPTY TaxAmount.
 */
export function buildPurchasesCsvRows(
  purchases: PurchaseForCsv[],
  stockCode: string,
  formatDate: (iso: string) => string,
): unknown[][] {
  const rows: unknown[][] = [];
  for (const v of purchases) {
    const d = formatDate(v.purchaseDate);
    const contact = [
      v.sellerName ?? "", "", v.sellerAddress ?? "", "", "", "", "", "", "",
      "United Kingdom", purchaseInvoiceNo(v), d, d,
    ];
    rows.push([
      ...contact, "", "",
      `${v.make} ${v.model} (${v.registrationNumber})`,
      1, v.totalPurchaseCost.toFixed(2), stockCode,
      v.vatQualifying ? "20% (VAT on Expenses)" : "Zero Rated Expenses",
      v.vatQualifying ? (v.purchaseVat ?? 0).toFixed(2) : "",
      "", "", "", "", "GBP",
    ]);
  }
  return rows;
}

/** Escape a CSV cell (quote when it contains a comma, quote or newline). */
export function csvEscape(cell: unknown): string {
  const s = String(cell ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Serialize headers + rows into CSV text. */
export function toCsv(headers: readonly string[], rows: unknown[][]): string {
  return [Array.from(headers) as unknown[], ...rows]
    .map((row) => row.map(csvEscape).join(","))
    .join("\n");
}
