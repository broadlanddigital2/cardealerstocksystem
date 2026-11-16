import { and, eq, desc } from "@workspace/db";
import { isDeepStrictEqual } from "./deepEqual";
import { db, issuedSalesTable, saleCreditsTable, saleRefundsTable, vehiclesTable, invoicesTable, invoiceArchiveTable, dealerSettingsTable, vehicleRevisionsTable, type IssuedSale, type Vehicle, type Invoice, type IssuedAccounting } from "@workspace/db";
import { InvoiceNumberConflict } from "./invoiceNumbers";
import { serializeVehicle, computeMargins } from "./vehicleSerializer";

export type LedgerTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const cents = (n: number | string) => Math.round(Number(n) * 100);
export function validMoney(n: number) {
  return Number.isFinite(n) && n >= 0 && n <= 999999999 && Math.abs(n * 100 - Math.round(n * 100)) < 0.00001;
}
export function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value && value <= new Date().toISOString().slice(0, 10);
}
export function hydrateVehicle(v: Vehicle): Vehicle {
  return { ...v, createdAt: new Date(v.createdAt), updatedAt: new Date(v.updatedAt), showroomRemoveAt: v.showroomRemoveAt ? new Date(v.showroomRemoveAt) : null };
}
export function issuedAmounts(vehicle: Vehicle & { issuedAccounting?: IssuedAccounting }, invoice: Invoice) {
  if (vehicle.issuedAccounting) {
    const { gross, net, vat } = vehicle.issuedAccounting;
    return { gross, net, vat };
  }
  const v = serializeVehicle(hydrateVehicle(vehicle));
  const extrasNet = (invoice.extras ?? []).reduce((s, e) => s + cents(e.amount), 0);
  const extrasVat = (invoice.extras ?? []).reduce((s, e) => s + cents(e.vat ?? 0), 0);
  const gross = cents(invoice.salePrice) + cents(invoice.saleVat ?? 0) + extrasNet + extrasVat;
  const vat = cents(vehicle.vatQualifying ? invoice.saleVat ?? 0 : v.vatDue ?? 0) + extrasVat;
  return { gross: gross / 100, vat: vat / 100, net: (gross - vat) / 100 };
}

function serializeAccountingVehicle(vehicle: Vehicle & { issuedAccounting?: IssuedAccounting }) {
  const serialized = serializeVehicle(hydrateVehicle(vehicle));
  const p = vehicle.issuedAccounting;
  return p ? { ...serialized, margin: p.margin, vatDue: p.vatDue, netMargin: p.netMargin } : serialized;
}

/** New issuance, or explicit admin document review; never automatic backfill. */
export async function snapshotIssuedSale(tx: LedgerTx, vehicle: Vehicle, invoice: Invoice, actor: string,
  reviewEvidence?: { documentReference: string; notes: string; expectedEditVersion: string }) {
  if (![invoice.salePrice, invoice.saleVat ?? 0, invoice.holdingDeposit ?? 0, ...(invoice.extras ?? []).flatMap(e => [e.amount, e.vat ?? 0])].every(n => validMoney(Number(n)))) {
    throw new InvoiceNumberConflict("Issued sale amounts must be non-negative, finite and entered to at most two decimal places.");
  }
  const [settings] = await tx.select().from(dealerSettingsTable).where(eq(dealerSettingsTable.userId, vehicle.userId));
  const serialized = serializeVehicle(vehicle);
  const issuedAccounting: IssuedAccounting = {
    margin: serialized.margin, vatDue: serialized.vatDue, netMargin: serialized.netMargin,
    totalMargin: computeMargins(serialized.totalPurchaseCost, serialized.salePrice).margin ?? 0,
    ...issuedAmounts(vehicle, invoice),
  };
  await tx.insert(issuedSalesTable).values({
    userId: vehicle.userId, vehicleId: vehicle.id, invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber, vehicle: { ...vehicle, issuedAccounting }, invoice, actor, reviewEvidence,
    accountingSettings: {
      vatRate: settings?.vatRate ?? null, vatQualifyingCode: settings?.vatQualifyingCode ?? null,
      carSalesCode: settings?.carSalesCode ?? null, carPurchasesCode: settings?.carPurchasesCode ?? null,
      stockCode: settings?.stockCode ?? null, otherSalesCode: settings?.otherSalesCode ?? null,
    },
  });
}

/** Freeze issued accounting, even for admins; later resale needs a new identity. */
export async function assertIssuedSaleNotEditable(tx: LedgerTx, userId: string, vehicleId: number) {
  const [issued] = await tx.select({ id: issuedSalesTable.id }).from(issuedSalesTable)
    .where(and(eq(issuedSalesTable.userId, userId), eq(issuedSalesTable.vehicleId, vehicleId)));
  if (issued) throw new InvoiceNumberConflict("Issued accounting is permanently read-only, including for admins. Use the cancellation action for a full credit. A returned vehicle must be entered as new stock after physical return; never edit this original sale.");
}

/** Operational receipts can still be maintained before cancellation without
 * rewriting the issued invoice/posting. Cancellation freezes these too. */
export async function isIssuedReceiptEdit(tx: LedgerTx, userId: string, vehicleId: number, changes: object) {
  const [issued] = await tx.select().from(issuedSalesTable).where(and(eq(issuedSalesTable.userId, userId), eq(issuedSalesTable.vehicleId, vehicleId)));
  if (!issued) return false;
  const [credit] = await tx.select().from(saleCreditsTable).where(and(eq(saleCreditsTable.userId, userId), eq(saleCreditsTable.issuedSaleId, issued.id)));
  if (!credit) {
    const requestedStatus = (changes as { status?: string }).status;
    if (requestedStatus && requestedStatus !== "sold")
      throw new InvoiceNumberConflict("Use cancellation to reverse a sale; its issued status cannot be cleared.");
    // Ordinary corrections use the normal invoice-sync path, with an append-only
    // revision captured in the same transaction. Do not rewrite issuance.
    return false;
  }
  const [current] = await tx.select().from(vehiclesTable).where(and(eq(vehiclesTable.userId, userId), eq(vehiclesTable.id, vehicleId)));
  if (!current) throw new InvoiceNumberConflict("Vehicle no longer exists. Refresh and try again.");
  const [invoice] = await tx.select().from(invoicesTable).where(and(eq(invoicesTable.userId, userId), eq(invoicesTable.vehicleId, vehicleId)));
  const invoiceFields = new Set(["financeCompanyName", "financeCompanyAddress", "financeCompanyEmail", "extras", "extrasOnFinanceInvoice"]);
  // The edit form always sends invoice settings, including []/false defaults.
  // Compare them with the invoice, not nonexistent columns on the vehicle.
  const normalizeExtras = (value: unknown) => ((value ?? []) as Array<Record<string, unknown>>).map(e => ({
    description: e.description,
    amount: Number(e.amount),
    vat: Number(e.vat ?? 0),
    onFinanceInvoice: e.onFinanceInvoice ?? invoice?.extrasOnFinanceInvoice ?? false,
  }));
  const metadata = new Set([
    "registrationNumber", "make", "model", "vin", "colour", "description",
    "mileageAtPurchase", "sellerName", "sellerAddress", "purchaseNotes",
    // Current contact corrections are audited separately; they do not rewrite
    // the cancelled invoice or the accounting snapshot approved for its credit.
    "buyerName", "buyerAddress", "buyerEmail", "buyerPhone",
    "purchaseDocumentReference", "askingPrice", "marketingDescription",
    "photoUrls", "published", "showroomSold", "showroomRemoveAt",
  ]);
  for (const [key, value] of Object.entries(changes)) {
    if (key === "expectedEditVersion" || value === undefined) continue;
    const source = invoiceFields.has(key) ? invoice : current;
    const original = (source as unknown as Record<string, unknown> | undefined)?.[key];
    if (key === "payments" && isDeepStrictEqual(original ?? [], value ?? [])) continue;
    if (key === "extras" && isDeepStrictEqual(normalizeExtras(original), normalizeExtras(value))) continue;
    if (key === "extrasOnFinanceInvoice" && (original ?? false) === value) continue;
    // Edit Vehicle sends unchanged accounting fields too. They are not edits.
    if (isDeepStrictEqual(original ?? null, value ?? null)) continue;
    if (["purchasePrice", "purchaseVat", "auctionCostNoVat", "auctionCostWithVat", "salePrice", "saleVat", "partExchangeAllowance"].includes(key) &&
        original != null && value != null &&
        Number.isFinite(Number(original)) && Number.isFinite(Number(value)) &&
        Number(original) === Number(value)) continue;
    if (metadata.has(key)) {
      if (credit && key === "published" && value === true)
        throw new InvoiceNumberConflict("A cancelled sale cannot be republished. Enter returned stock separately.");
      continue;
    }
    if (!credit && ["payments", "numberOfPayments"].includes(key)) continue;
    throw new InvoiceNumberConflict(`The issued accounting field "${key}" cannot be changed here. Vehicle details can be edited, but the original invoice and retained accounting must remain unchanged.`);
  }
  return true;
}

export async function recordVehicleRevision(
  tx: LedgerTx, before: Vehicle, beforeInvoice: Invoice | undefined,
  after: Vehicle, actor: string,
) {
  const [afterInvoice] = await tx.select().from(invoicesTable).where(and(eq(invoicesTable.userId, after.userId), eq(invoicesTable.vehicleId, after.id)));
  const clean = (value: unknown) => JSON.stringify(value, (key, v) => key === "updatedAt" ? undefined : v);
  if (clean(before) === clean(after) && clean(beforeInvoice) === clean(afterInvoice)) return;
  const [issued] = await tx.select().from(issuedSalesTable).where(and(eq(issuedSalesTable.userId, after.userId), eq(issuedSalesTable.vehicleId, after.id)));
  const serialized = serializeVehicle(after);
  const afterVehicle = afterInvoice ? { ...after, issuedAccounting: {
    margin: serialized.margin, vatDue: serialized.vatDue, netMargin: serialized.netMargin,
    totalMargin: computeMargins(serialized.totalPurchaseCost, serialized.salePrice).margin ?? 0,
    ...issuedAmounts(after, afterInvoice),
  } } : after;
  await tx.insert(vehicleRevisionsTable).values({
    userId: after.userId, vehicleId: after.id, issuedSaleId: issued?.id ?? null,
    actor, beforeVehicle: before, afterVehicle,
    beforeInvoice: beforeInvoice ?? null, afterInvoice: afterInvoice ?? null,
  });
}

/** Resolve current accounting from immutable corrections, preserving first issuance. */
export async function effectiveIssuedSales(connection: LedgerTx | typeof db, userId: string): Promise<IssuedSale[]> {
  const sales = await connection.select().from(issuedSalesTable).where(eq(issuedSalesTable.userId, userId));
  const revisions = await connection.select().from(vehicleRevisionsTable).where(eq(vehicleRevisionsTable.userId, userId)).orderBy(desc(vehicleRevisionsTable.id));
  const credits = await connection.select().from(saleCreditsTable).where(eq(saleCreditsTable.userId, userId));
  return sales.map(s => {
    const credit = credits.find(c => c.issuedSaleId === s.id);
    const frozen = credit?.request.accountingSnapshot as { vehicle: IssuedSale["vehicle"]; invoice: IssuedSale["invoice"] } | undefined;
    if (frozen) return { ...s, ...frozen };
    const revision = revisions.find(r => r.issuedSaleId === s.id && r.afterInvoice &&
      (!credit || r.createdAt <= credit.createdAt));
    return revision ? { ...s, vehicle: revision.afterVehicle, invoice: revision.afterInvoice! } : s;
  });
}

export async function receiptsAtCancellation(tx: LedgerTx | typeof db, userId: string, vehicleId: number, original: Vehicle) {
  const [live] = await tx.select().from(vehiclesTable).where(and(eq(vehiclesTable.userId, userId), eq(vehiclesTable.id, vehicleId)));
  if (live) return live.payments ?? [];
  const [archive] = await tx.select().from(invoiceArchiveTable).where(and(eq(invoiceArchiveTable.userId, userId), eq(invoiceArchiveTable.vehicleId, vehicleId))).orderBy(desc(invoiceArchiveTable.id)).limit(1);
  return (archive?.vehicleSnapshot as unknown as Vehicle | undefined)?.payments ?? original.payments ?? [];
}

export async function cancellationState(userId: string, vehicleId: number, connection: LedgerTx | typeof db = db) {
  const sale = (await effectiveIssuedSales(connection, userId)).find(s => s.vehicleId === vehicleId);
  if (!sale) return { eligible: false, cancelled: false, reviewRequired: true, gross: 0, deposit: 0, message: "Accounting review required. An admin must check the displayed figures against the original documents and approve the review before cancellation." };
  const [credit] = await connection.select().from(saleCreditsTable).where(and(eq(saleCreditsTable.userId, userId), eq(saleCreditsTable.issuedSaleId, sale.id)));
  const receipts = await receiptsAtCancellation(connection, userId, vehicleId, sale.vehicle);
  const complex = !!sale.invoice.financeCompanyName || /finance/i.test(sale.invoice.paymentMethod ?? "") ||
    Number(sale.vehicle.partExchangeAllowance ?? 0) !== 0 || !!sale.vehicle.partExchangeVehicleId ||
    receipts.some(p => Number(p.amount) < 0 || /finance|part.?exchange|px|payment to customer|refund|outgoing|deposit/i.test(`${p.type} ${p.paymentMethod}`));
  return {
    eligible: !credit && !complex, cancelled: !!credit,
    gross: issuedAmounts(sale.vehicle, sale.invoice).gross, deposit: Number(sale.invoice.holdingDeposit ?? 0),
    ...(credit ? { creditId: credit.id, creditNumber: credit.creditNumber } : {}),
    message: credit ? "Cancelled by full credit. Original sale is retained; no money has been transferred by this app."
      : complex ? "Finance, part-exchange or existing payment reconciliation required. Cancellation is blocked: lender settlements, PX returns, customer payouts and separately labelled deposits cannot be inferred or counted twice. Obtain an accountant-reviewed resolution outside this workflow."
        : "Eligible for one full credit. Confirm all actual receipts, including the holding deposit and unpaid balances. Cancellation does not transfer money or return stock automatically.",
  };
}

/** One original per vehicle, irrespective of live/archive retention. New issuance
 * snapshots take precedence. Legacy archive values remain legacy, never eligible
 * for credit; retaining their existing reporting basis is not certification. */
export async function accountingSources(userId: string) {
  return db.transaction(async tx => {
  const live = await tx.select().from(vehiclesTable).where(eq(vehiclesTable.userId, userId));
  const invoices = await tx.select().from(invoicesTable).where(eq(invoicesTable.userId, userId));
  const issued = await effectiveIssuedSales(tx, userId);
  const archives = await tx.select().from(invoiceArchiveTable).where(eq(invoiceArchiveTable.userId, userId));
  const credits = await tx.select().from(saleCreditsTable).where(eq(saleCreditsTable.userId, userId));
  const vehicles = new Map(live.map(v => [v.id, v]));
  const invoiceMap = new Map(invoices.map(i => [i.id, i]));
  for (const a of archives.sort((a, b) => b.id - a.id)) {
    if (!vehicles.has(a.vehicleId)) vehicles.set(a.vehicleId, hydrateVehicle(a.vehicleSnapshot as unknown as Vehicle));
    const i = a.invoiceSnapshot as unknown as Invoice | null;
    if (i && !invoiceMap.has(i.id)) invoiceMap.set(i.id, i);
  }
  for (const s of issued) {
    vehicles.set(s.vehicleId, hydrateVehicle(s.vehicle));
    invoiceMap.set(s.invoiceId, s.invoice);
  }
  // Deleted stock must never return to the active stock count.
  const liveIds = new Set(live.map(v => v.id));
  return { vehicles: [...vehicles.values()], invoices: [...invoiceMap.values()], issued, credits, liveIds };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

export async function saleReportRows(userId: string) {
  const source = await accountingSources(userId);
  const originals = source.vehicles.filter(v => v.status === "sold").map(v => ({
    ...serializeAccountingVehicle(v), accountingEntryType: "sale", originalInvoiceNumber: v.salesInvoiceNumber,
    accountingArchived: !source.liveIds.has(v.id),
    accountingExtras: source.invoices.find(i => i.vehicleId === v.id)?.extras ?? [],
    accountingSettings: source.issued.find(s => s.vehicleId === v.id)?.accountingSettings,
  }));
  const reversals = source.credits.map(c => {
    const sale = source.issued.find(s => s.id === c.issuedSaleId)!;
    const v = serializeAccountingVehicle(sale.vehicle);
    return { ...v, id: -c.id, saleDate: c.cancellationDate, salesInvoiceNumber: c.creditNumber,
      accountingEntryType: "credit", originalInvoiceNumber: sale.invoiceNumber,
      accountingSettings: sale.accountingSettings,
      salePrice: -(v.salePrice ?? 0), saleVat: -(v.saleVat ?? 0),
      margin: v.margin == null ? null : -v.margin, vatDue: v.vatDue == null ? null : -v.vatDue,
      netMargin: v.netMargin == null ? null : -v.netMargin,
      // Credit is not a purchase reversal or a stock movement.
      purchasePrice: 0, totalPurchaseCost: 0, purchaseVat: 0,
      accountingExtras: (sale.invoice.extras ?? []).map(e => ({ ...e, amount: -e.amount, vat: -(e.vat ?? 0) })),
    };
  });
  return [...originals, ...reversals];
}

export async function refundBalance(userId: string, creditId: number, received: string, tx: LedgerTx | typeof db = db) {
  const refunds = await tx.select().from(saleRefundsTable).where(and(eq(saleRefundsTable.userId, userId), eq(saleRefundsTable.creditId, creditId)));
  const paid = refunds.reduce((s, r) => s + cents(r.amount), 0);
  const due = cents(received) - paid;
  return { refunds, due: due / 100, state: cents(received) === 0 ? "no refund due" : due === 0 ? "fully refunded" : paid ? "partially refunded" : "pending" };
}
