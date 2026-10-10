import { computeMargins, round2 } from "./money";
import { vatPeriodRange } from "./vatPeriod";

/**
 * Pure computation behind the dashboard summary (VAT boxes, sales/margin
 * totals, stock value and their click-through breakdowns). Extracted from the
 * dashboard route so the VAT figures that feed the client's VAT return can be
 * unit-tested without a database.
 *
 * Money fields accept `string | number` because the API server passes raw
 * Drizzle rows (numeric columns are strings) while tests pass plain numbers.
 */

type Money = string | number;

export type VehicleForSummary = {
  id: number;
  stockNumber: string;
  registrationNumber: string;
  make: string;
  model: string;
  status: string;
  purchaseDate: string | null;
  saleDate: string | null;
  purchasePrice: Money;
  auctionCostNoVat: Money | null;
  vatQualifying: boolean | null;
  purchaseVat: Money | null;
  saleVat: Money | null;
  salePrice: Money | null;
};

export type InvoiceForSummary = {
  invoiceNumber: string;
  invoiceDate: string;
  extras: Array<{ vat?: number | null }> | null;
};

export type DetailItem = {
  id: string;
  label: string;
  sublabel: string | null;
  amount: number;
};

const ddmmyyyy = (s: string | null) => {
  if (!s) return "";
  const [y, m, d] = s.split("-");
  return d && m && y ? `${d}/${m}/${y}` : s;
};

export function computeDashboardSummary(
  vehicles: VehicleForSummary[],
  invoices: InvoiceForSummary[],
  now: Date,
  vatQuarter: string | null,
) {
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const quarter = vatPeriodRange(now, vatQuarter);

  // Per-box breakdowns so each dashboard total can be clicked to reveal the
  // records behind it. Each item's `amount` is signed so the list sums to the
  // headline figure (input VAT lines are negative). `stockDetail` backs both
  // the "Vehicles in Stock" and "Total Stock Value" boxes.
  const salesThisMonthDetail: DetailItem[] = [];
  const netMarginThisMonthDetail: DetailItem[] = [];
  const vatThisMonthDetail: DetailItem[] = [];
  const vatThisQuarterDetail: DetailItem[] = [];
  const stockDetail: DetailItem[] = [];

  let inStockCount = 0;
  let soldThisMonthCount = 0;
  let totalPurchasesThisMonth = 0;
  let totalSalesThisMonth = 0;
  let totalMarginThisMonth = 0;
  let marginVatThisMonth = 0;
  let marginVatThisQuarter = 0;
  let standardVatThisMonth = 0;
  let standardVatThisQuarter = 0;
  // Input VAT reclaimable on VAT-qualifying purchases, attributed to the period
  // of the purchase. The headline VAT figures net this off the output VAT.
  let purchaseVatThisMonth = 0;
  let purchaseVatThisQuarter = 0;
  let totalStockValue = 0;

  for (const r of vehicles) {
    const purchasePrice = Number(r.purchasePrice);
    // No-VAT auction fees are part of a vehicle's acquisition cost, so every
    // cost and margin figure below is based on the total purchase cost
    // (purchase price + no-VAT auction fees), matching the vehicle serializer
    // used by the stock, purchases and sales reports.
    const totalPurchaseCost =
      purchasePrice + (r.auctionCostNoVat == null ? 0 : Number(r.auctionCostNoVat));
    const vehicleLabel = `${r.registrationNumber} — ${r.make} ${r.model}`;
    if (r.status === "in_stock" || r.status === "reserved") {
      inStockCount++;
      totalStockValue += totalPurchaseCost;
      stockDetail.push({
        id: `stock-${r.id}`,
        label: vehicleLabel,
        sublabel: `Stock ${r.stockNumber}`,
        amount: round2(totalPurchaseCost),
      });
    }
    const purchaseVat =
      r.vatQualifying && r.purchaseVat != null ? Number(r.purchaseVat) : 0;
    if (r.purchaseDate?.startsWith(monthPrefix)) {
      totalPurchasesThisMonth += totalPurchaseCost;
      purchaseVatThisMonth += purchaseVat;
      if (purchaseVat !== 0) {
        vatThisMonthDetail.push({
          id: `inpv-m-${r.id}`,
          label: "Input VAT reclaimed",
          sublabel: vehicleLabel,
          amount: round2(-purchaseVat),
        });
      }
    }
    if (
      r.purchaseDate &&
      r.purchaseDate >= quarter.startStr &&
      r.purchaseDate < quarter.endExclusiveStr
    ) {
      purchaseVatThisQuarter += purchaseVat;
      if (purchaseVat !== 0) {
        vatThisQuarterDetail.push({
          id: `inpv-q-${r.id}`,
          label: "Input VAT reclaimed",
          sublabel: vehicleLabel,
          amount: round2(-purchaseVat),
        });
      }
    }
    if (r.status === "sold" && r.saleDate) {
      const salePrice = r.salePrice == null ? null : Number(r.salePrice);
      const { margin, vatDue } = computeMargins(totalPurchaseCost, salePrice);
      // VAT-qualifying vehicles are standard-rated, not on the margin scheme:
      // they charge separate output VAT (saleVat) and contribute no margin VAT.
      const marginVat = r.vatQualifying ? 0 : vatDue ?? 0;
      const standardVat =
        r.vatQualifying && r.saleVat != null ? Number(r.saleVat) : 0;
      const outputVat = marginVat + standardVat;
      const vatLabel = r.vatQualifying
        ? "Output VAT (VAT-qualifying sale)"
        : "Margin VAT";
      if (r.saleDate.startsWith(monthPrefix)) {
        soldThisMonthCount++;
        totalSalesThisMonth += salePrice ?? 0;
        totalMarginThisMonth += margin ?? 0;
        marginVatThisMonth += marginVat;
        standardVatThisMonth += standardVat;
        salesThisMonthDetail.push({
          id: `sale-${r.id}`,
          label: vehicleLabel,
          sublabel: `Sold ${ddmmyyyy(r.saleDate)}`,
          amount: round2(salePrice ?? 0),
        });
        netMarginThisMonthDetail.push({
          id: `nm-${r.id}`,
          label: vehicleLabel,
          sublabel: `Sold ${ddmmyyyy(r.saleDate)}`,
          amount: round2((margin ?? 0) - marginVat),
        });
        if (outputVat !== 0) {
          vatThisMonthDetail.push({
            id: `ov-m-${r.id}`,
            label: vatLabel,
            sublabel: vehicleLabel,
            amount: round2(outputVat),
          });
        }
      }
      if (r.saleDate >= quarter.startStr && r.saleDate < quarter.endExclusiveStr) {
        marginVatThisQuarter += marginVat;
        standardVatThisQuarter += standardVat;
        if (outputVat !== 0) {
          vatThisQuarterDetail.push({
            id: `ov-q-${r.id}`,
            label: vatLabel,
            sublabel: vehicleLabel,
            amount: round2(outputVat),
          });
        }
      }
    }
  }

  // Standard VAT also includes the VAT charged on invoice extras (e.g. admin
  // fees, warranties) for invoices dated within the current month/VAT period.
  for (const inv of invoices) {
    const inMonth = inv.invoiceDate.startsWith(monthPrefix);
    const inQuarter =
      inv.invoiceDate >= quarter.startStr &&
      inv.invoiceDate < quarter.endExclusiveStr;
    if (!inMonth && !inQuarter) continue;
    let extrasVat = 0;
    for (const extra of inv.extras ?? []) {
      const vat = Number(extra.vat ?? 0);
      if (Number.isFinite(vat)) extrasVat += vat;
    }
    if (inMonth) {
      standardVatThisMonth += extrasVat;
      if (extrasVat !== 0) {
        vatThisMonthDetail.push({
          id: `exv-m-${inv.invoiceNumber}`,
          label: "Extras VAT",
          sublabel: `Invoice ${inv.invoiceNumber}`,
          amount: round2(extrasVat),
        });
      }
    }
    if (inQuarter) {
      standardVatThisQuarter += extrasVat;
      if (extrasVat !== 0) {
        vatThisQuarterDetail.push({
          id: `exv-q-${inv.invoiceNumber}`,
          label: "Extras VAT",
          sublabel: `Invoice ${inv.invoiceNumber}`,
          amount: round2(extrasVat),
        });
      }
    }
  }

  // The headline VAT figures combine margin-scheme VAT and standard output VAT,
  // less the input VAT reclaimable on VAT-qualifying purchases in the period.
  const vatDueThisMonth =
    marginVatThisMonth + standardVatThisMonth - purchaseVatThisMonth;
  const vatDueThisQuarter =
    marginVatThisQuarter + standardVatThisQuarter - purchaseVatThisQuarter;

  return {
    inStockCount,
    soldThisMonthCount,
    totalPurchasesThisMonth: round2(totalPurchasesThisMonth),
    totalSalesThisMonth: round2(totalSalesThisMonth),
    totalMarginThisMonth: round2(totalMarginThisMonth),
    netMarginThisMonth: round2(totalMarginThisMonth - marginVatThisMonth),
    vatDueThisMonth: round2(vatDueThisMonth),
    vatDueThisQuarter: round2(vatDueThisQuarter),
    standardVatThisQuarter: round2(standardVatThisQuarter),
    vatQuarterLabel: quarter.label,
    totalStockValue: round2(totalStockValue),
    salesThisMonthDetail,
    netMarginThisMonthDetail,
    vatThisMonthDetail,
    vatThisQuarterDetail,
    stockDetail,
  };
}
