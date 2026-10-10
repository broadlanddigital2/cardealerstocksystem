import type { Vehicle as VehicleRow } from "@workspace/db";
import { round2, computeMargins } from "@workspace/report-calc";

// The VAT Margin Scheme calculation lives in @workspace/report-calc so both
// the API server and the frontend share one tested implementation.
export { computeMargins };

export function serializeVehicle(row: VehicleRow, hasInvoice = false) {
  const purchasePrice = Number(row.purchasePrice);
  const auctionCostNoVat =
    row.auctionCostNoVat == null ? null : Number(row.auctionCostNoVat);
  const auctionCostWithVat =
    row.auctionCostWithVat == null ? null : Number(row.auctionCostWithVat);
  // No-VAT auction costs are added to the purchase price for margin purposes.
  const totalPurchaseCost = purchasePrice + (auctionCostNoVat ?? 0);
  const salePrice = row.salePrice == null ? null : Number(row.salePrice);
  const purchaseVat = row.purchaseVat == null ? null : Number(row.purchaseVat);
  const saleVat = row.saleVat == null ? null : Number(row.saleVat);
  // VAT-qualifying vehicles are sold under standard VAT rules, not the margin
  // scheme, so the margin-scheme figures do not apply.
  const { margin, vatDue, netMargin } = row.vatQualifying
    ? { margin: null, vatDue: null, netMargin: null }
    : computeMargins(totalPurchaseCost, salePrice);

  return {
    id: row.id,
    stockNumber: row.stockNumber,
    purchaseNumber: row.purchaseNumber,
    registrationNumber: row.registrationNumber,
    make: row.make,
    model: row.model,
    vin: row.vin,
    colour: row.colour,
    description: row.description,
    mileageAtPurchase: row.mileageAtPurchase,
    purchaseDate: row.purchaseDate,
    purchaseInvoiceNumber: row.purchaseInvoiceNumber,
    purchaseType: row.purchaseType,
    sellerName: row.sellerName,
    sellerAddress: row.sellerAddress,
    purchasePrice,
    purchaseNotes: row.purchaseNotes,
    purchaseDocumentReference: row.purchaseDocumentReference,
    auctionCostNoVat,
    auctionCostWithVat,
    totalPurchaseCost,
    vatQualifying: row.vatQualifying,
    purchaseVat,
    saleVat,
    status: row.status,
    holdingDepositAmount:
      row.holdingDepositAmount == null
        ? null
        : Number(row.holdingDepositAmount),
    holdingDepositDate: row.holdingDepositDate,
    holdingDepositReference: row.holdingDepositReference,
    holdingDepositPaymentMethod: row.holdingDepositPaymentMethod,
    saleDate: row.saleDate,
    salesInvoiceNumber: row.salesInvoiceNumber,
    buyerName: row.buyerName,
    buyerAddress: row.buyerAddress,
    buyerEmail: row.buyerEmail,
    buyerPhone: row.buyerPhone,
    salePrice,
    mileageAtSale: row.mileageAtSale,
    methodOfDisposal: row.methodOfDisposal,
    saleNotes: row.saleNotes,
    invoiceNotes: row.invoiceNotes,
    paymentMethod: row.paymentMethod,
    numberOfPayments: row.numberOfPayments,
    payments: row.payments ?? null,
    partExchangeAllowance:
      row.partExchangeAllowance == null
        ? null
        : Number(row.partExchangeAllowance),
    partExchangeMake: row.partExchangeMake,
    partExchangeModel: row.partExchangeModel,
    partExchangeRegistration: row.partExchangeRegistration,
    partExchangeMileage: row.partExchangeMileage,
    partExchangeVehicleId: row.partExchangeVehicleId,
    margin,
    vatDue,
    netMargin,
    hasInvoice,
    askingPrice: row.askingPrice == null ? null : Number(row.askingPrice),
    marketingDescription: row.marketingDescription,
    published: row.published,
    showroomSold: row.showroomSold,
    showroomRemoveAt: row.showroomRemoveAt
      ? row.showroomRemoveAt.toISOString()
      : null,
    photoUrls: row.photoUrls ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Public showroom serializer. STRICT field allowlist for the customer-facing
 * website: only dealer-chosen marketing fields are exposed — never purchase
 * price, VAT figures, seller/buyer details, stock/purchase numbers, dates, or
 * any other accounting/PII data. Add new fields here ONLY if they are safe to
 * show to anonymous visitors.
 */
export function serializeShowroomVehicle(row: VehicleRow) {
  return {
    id: row.id,
    make: row.make,
    model: row.model,
    // Spec/derivative line (e.g. "1.1 SE 3dr") — dealer-entered marketing
    // copy, safe for anonymous visitors.
    description: row.description,
    registrationNumber: row.registrationNumber,
    colour: row.colour,
    mileage: row.mileageAtPurchase,
    askingPrice: row.askingPrice == null ? null : Number(row.askingPrice),
    marketingDescription: row.marketingDescription,
    showroomSold: row.showroomSold,
    photoUrls: row.photoUrls ?? [],
  };
}

export function serializeInvoice(row: {
  id: number;
  vehicleId: number;
  invoiceNumber: string;
  invoiceDate: string;
  customerName: string;
  customerAddress: string;
  salePrice: string;
  saleVat: string | null;
  paymentMethod: string | null;
  partExchangeAllowance: string | null;
  balancePayable: string;
  holdingDeposit: string | null;
  extras: Array<{
    description: string;
    amount: number;
    vat?: number;
    onFinanceInvoice?: boolean;
  }> | null;
  extrasOnFinanceInvoice: boolean;
  notes: string | null;
  financeCompanyName: string | null;
  financeCompanyAddress: string | null;
  financeCompanyEmail: string | null;
  createdAt: Date;
}) {
  // Extras are billed per item: each may go on the finance/vehicle invoice or on
  // a separate extras invoice. Legacy rows have no per-item flag, so fall back to
  // the invoice-level extrasOnFinanceInvoice choice for those.
  const extrasGross = (row.extras ?? [])
    .filter((e) => e.onFinanceInvoice ?? row.extrasOnFinanceInvoice)
    .reduce((sum, e) => sum + e.amount + (e.vat ?? 0), 0);
  return {
    id: row.id,
    vehicleId: row.vehicleId,
    invoiceNumber: row.invoiceNumber,
    invoiceDate: row.invoiceDate,
    customerName: row.customerName,
    customerAddress: row.customerAddress,
    salePrice: Number(row.salePrice),
    saleVat: row.saleVat == null ? null : Number(row.saleVat),
    paymentMethod: row.paymentMethod,
    partExchangeAllowance:
      row.partExchangeAllowance == null
        ? null
        : Number(row.partExchangeAllowance),
    // Balance payable is derived on read for display consistency: sale price
    // plus any sale VAT (VAT-qualifying vehicles), less part-exchange and
    // holding deposit. Extras are normally billed on a separate VAT invoice and
    // excluded here; only when extrasOnFinanceInvoice is set do the extras
    // (gross) get added so the finance invoice total reflects them.
    balancePayable:
      round2(
        Number(row.salePrice) +
          Number(row.saleVat ?? 0) -
          Number(row.partExchangeAllowance ?? 0) -
          Number(row.holdingDeposit ?? 0) +
          extrasGross,
      ),
    holdingDeposit:
      row.holdingDeposit == null ? null : Number(row.holdingDeposit),
    extras: row.extras ?? null,
    extrasOnFinanceInvoice: row.extrasOnFinanceInvoice,
    notes: row.notes,
    financeCompanyName: row.financeCompanyName,
    financeCompanyAddress: row.financeCompanyAddress,
    financeCompanyEmail: row.financeCompanyEmail,
    createdAt: row.createdAt.toISOString(),
  };
}
