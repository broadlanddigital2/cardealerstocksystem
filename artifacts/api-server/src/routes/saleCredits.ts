import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import { db, issuedSalesTable, saleCreditsTable, saleRefundsTable, depositRefundsTable, vehiclesTable, vehicleRevisionsTable } from "@workspace/db";
import { CancelIssuedSaleBody, CancelIssuedSaleParams, ConfirmSaleRefundBody, ConfirmSaleRefundParams, ConfirmSaleRefundResponse, GetCancellationStateParams, GetCancellationStateResponse, ListAccountingHistoryResponse, type AccountingHistoryEntry } from "@workspace/api-zod";
import { requireAdmin, requireAuth, getSessionUserId } from "../middlewares/requireAuth";
import { cancellationState, cents, validMoney, validDate, issuedAmounts, refundBalance, receiptsAtCancellation, effectiveIssuedSales } from "../lib/saleLedger";
import { lockInvoiceNumbers, nextInvoiceNumber, InvoiceNumberConflict, invoiceNumberError } from "../lib/invoiceNumbers";
import { returnRefundedStock } from "../lib/returnRefundedStock";
import { vehicleSaleHistory } from "../lib/vehicleSaleHistory";
import { GetVehicleSaleHistoryParams, GetVehicleSaleHistoryResponse } from "@workspace/api-zod";

const router: IRouter = Router();

async function history(userId: string): Promise<AccountingHistoryEntry[]> {
  return db.transaction(async tx => {
  const sales = await effectiveIssuedSales(tx, userId);
  const credits = await tx.select().from(saleCreditsTable).where(eq(saleCreditsTable.userId, userId));
  const liveVehicles = await tx.select().from(vehiclesTable).where(eq(vehiclesTable.userId, userId));
  const deposits = await tx.select().from(depositRefundsTable).where(eq(depositRefundsTable.userId, userId));
  const entries: AccountingHistoryEntry[] = [];
  const originals = await tx.select().from(issuedSalesTable).where(eq(issuedSalesTable.userId, userId));
  for (const s of originals.filter(s => s.reviewEvidence)) entries.push({
    id: `review-${s.id}`, type: "review", vehicleId: s.vehicleId,
    registration: `${s.vehicle.stockNumber} / ${s.vehicle.registrationNumber}`,
    invoiceNumber: s.invoiceNumber, invoiceDate: s.invoice.invoiceDate, creditNumber: "", creditDate: "",
    date: s.createdAt.toISOString().slice(0, 10), recordedAt: s.createdAt.toISOString(), actor: s.actor,
    reason: "Original accounting documents reviewed by admin", amount: 0, net: 0, vat: 0,
    refundDue: 0, refundState: "not applicable", recipient: "", reference: s.reviewEvidence!.documentReference,
    method: "", reconciliation: s.reviewEvidence!.notes,
    originalDocument: JSON.stringify({ invoice: s.invoice, vehicle: s.vehicle, review: s.reviewEvidence }),
  });
  const revisions = await tx.select().from(vehicleRevisionsTable).where(eq(vehicleRevisionsTable.userId, userId));
  for (const r of revisions) entries.push({
    id: `correction-${r.id}`, type: "correction", vehicleId: r.vehicleId,
    registration: `${r.afterVehicle.stockNumber} / ${r.afterVehicle.registrationNumber}`,
    invoiceNumber: r.afterInvoice?.invoiceNumber ?? "", invoiceDate: r.afterInvoice?.invoiceDate ?? "",
    creditNumber: "", creditDate: "", date: r.createdAt.toISOString().slice(0, 10),
    actor: r.actor, recordedAt: r.createdAt.toISOString(), amount: 0, net: 0, vat: 0,
    reason: "Vehicle, purchase or sale information corrected",
    refundDue: 0, refundState: "not applicable", recipient: "", reference: "", method: "",
    reconciliation: "Correction history only; not an additional sale, credit or refund posting.",
    originalDocument: JSON.stringify({ beforeVehicle: r.beforeVehicle, afterVehicle: r.afterVehicle,
      beforeInvoice: r.beforeInvoice, afterInvoice: r.afterInvoice }),
  });
  for (const c of credits) {
    const s = sales.find(s => s.id === c.issuedSaleId);
    if (!s) throw new Error("Credit has no retained issuance snapshot");
    const amounts = issuedAmounts(s.vehicle, s.invoice);
    const balance = await refundBalance(userId, c.id, c.receivedAmount, tx);
    const base = {
      vehicleId: s.vehicleId, creditId: c.id, registration: `${s.vehicle.stockNumber} / ${s.vehicle.registrationNumber} / ${s.vehicle.make} ${s.vehicle.model}`,
      invoiceNumber: s.invoiceNumber, invoiceDate: s.invoice.invoiceDate, creditNumber: c.creditNumber, creditDate: c.cancellationDate,
      reason: c.reason, refundDue: balance.due, refundState: balance.state,
      canRefund: balance.due > 0 && liveVehicles.some(v => v.id === s.vehicleId && v.status === "sold"),
      reconciliation: c.reconciliation, originalDocument: JSON.stringify({ invoice: s.invoice, vehicle: s.vehicle, receiptsAtCancellation: c.request.receiptSnapshot }),
    };
    entries.push({ ...base, id: `credit-${c.id}`, type: "credit", date: c.cancellationDate, actor: c.actor,
      recordedAt: c.createdAt.toISOString(), amount: -amounts.gross, net: -amounts.net, vat: -amounts.vat,
      recipient: s.invoice.customerName, reference: "", method: "" });
    for (const r of balance.refunds) entries.push({
      ...base, id: `refund-${r.id}`, type: "refund", date: r.paymentDate, actor: r.actor,
      recordedAt: r.createdAt.toISOString(), amount: Number(r.amount), net: 0, vat: 0,
      recipient: r.recipient, reference: r.reference, method: r.method,
      reason: r.reason ?? c.reason, returnedVehicleId: r.returnedVehicleId ?? undefined,
      returnedVehicleAvailable: r.returnedVehicleId ? liveVehicles.some(v => v.id === r.returnedVehicleId) : undefined,
    });
  }
  for (const d of deposits) entries.push({
    id: `deposit-${d.id}`, type: "deposit_refund", vehicleId: d.vehicleId,
    registration: `${d.stockNumber} / ${d.registrationNumber} / ${d.make} ${d.model}`,
    invoiceNumber: "", invoiceDate: "", creditNumber: "", creditDate: "", date: d.refundDate, reason: "Reserved holding deposit refunded",
    actor: d.actor ?? "Historical actor unknown", recordedAt: d.createdAt.toISOString(),
    amount: Number(d.depositAmount), net: 0, vat: 0, refundDue: 0, refundState: "fully refunded",
    recipient: d.buyerName ?? "Historical recipient unknown", reference: d.depositReference ?? "",
    method: "Historical payment method not recorded", reconciliation: "Deposit refund record; not a sale/VAT reversal.",
    originalDocument: JSON.stringify(d),
  });
  return entries.sort((a, b) => b.date.localeCompare(a.date) || b.recordedAt.localeCompare(a.recordedAt));
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

router.get("/accounting-history", requireAdmin, async (req, res) => {
  res.json(ListAccountingHistoryResponse.parse(await history(req.userId!)));
});
router.get("/vehicles/:id/sale-history", requireAdmin, async (req, res) => {
  const params = GetVehicleSaleHistoryParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid vehicle ID." }); return; }
  const userId = req.userId!;
  const events = await db.transaction(async tx => {
    const vehicles = await tx.select().from(vehiclesTable).where(eq(vehiclesTable.userId, userId));
    const sales = await tx.select().from(issuedSalesTable).where(eq(issuedSalesTable.userId, userId));
    const credits = await tx.select().from(saleCreditsTable).where(eq(saleCreditsTable.userId, userId));
    const refunds = await tx.select().from(saleRefundsTable).where(eq(saleRefundsTable.userId, userId));
    const revisions = await tx.select().from(vehicleRevisionsTable).where(eq(vehicleRevisionsTable.userId, userId));
    return vehicleSaleHistory(params.data.id, vehicles, sales, credits, refunds, revisions);
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
  if (!events) { res.status(404).json({ error: "No retained stock history found." }); return; }
  res.json(GetVehicleSaleHistoryResponse.parse(events));
});
router.get("/vehicles/:id/cancellation", requireAuth, async (req, res) => {
  const params = GetCancellationStateParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  res.json(GetCancellationStateResponse.parse(await cancellationState(req.userId!, params.data.id)));
});
router.post("/vehicles/:id/cancellation", requireAdmin, async (req, res) => {
  const params = CancelIssuedSaleParams.safeParse(req.params);
  const body = CancelIssuedSaleBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid cancellation details." }); return; }
  const userId = req.userId!;
  const d = body.data;
  if (!validDate(d.cancellationDate) || !validMoney(d.receivedAmount) || !d.reason.trim() || !d.reconciliation.trim() || !d.receiptsConfirmed) {
    res.status(400).json({ error: "Enter a valid non-future date, a receipts amount to two decimals, reason and explicit reconciliation." }); return;
  }
  try {
    await db.transaction(async tx => {
      await lockInvoiceNumbers(tx, userId);
      const sale = (await effectiveIssuedSales(tx, userId)).find(s => s.vehicleId === params.data.id);
      const state = await cancellationState(userId, params.data.id, tx);
      if (!sale) throw new InvoiceNumberConflict(state.message);
      const [existing] = await tx.select().from(saleCreditsTable).where(and(eq(saleCreditsTable.userId, userId), eq(saleCreditsTable.issuedSaleId, sale.id)));
      if (existing) {
        const { receiptSnapshot: _receipts, accountingSnapshot: _accounting, ...approvedRequest } = existing.request;
        if (isDeepStrictEqual(approvedRequest, d)) return;
        throw new InvoiceNumberConflict("A full credit already exists. Its date, reason and reconciled receipts cannot be edited.");
      }
      if (!state.eligible) throw new InvoiceNumberConflict(state.message);
      if (d.cancellationDate < sale.invoice.invoiceDate) throw new InvoiceNumberConflict("Cancellation cannot predate the original sale.");
      if (cents(d.receivedAmount) > cents(state.gross) || cents(d.receivedAmount) < cents(state.deposit)) throw new InvoiceNumberConflict("Reconciled receipts must include the holding deposit and cannot exceed the full invoice total.");
      // All recorded cash receipts must be accounted for. PX/finance blocked above.
      const receiptSnapshot = await receiptsAtCancellation(tx, userId, sale.vehicleId, sale.vehicle);
      const recordedReceipts = receiptSnapshot.reduce((s, p) => s + cents(p.amount), cents(state.deposit));
      if (cents(d.receivedAmount) < recordedReceipts) throw new InvoiceNumberConflict("Reconciled receipts cannot be less than the deposit plus recorded payments. Resolve the receipts discrepancy before cancellation.");
      const creditNumber = (await nextInvoiceNumber(tx, userId)).replace(/^INV-/, "CR-");
      await tx.insert(saleCreditsTable).values({
        userId, issuedSaleId: sale.id, creditNumber, cancellationDate: d.cancellationDate,
        reason: d.reason, reconciliation: d.reconciliation, receivedAmount: d.receivedAmount.toFixed(2),
        actor: getSessionUserId(req)!, request: { ...d, receiptSnapshot, accountingSnapshot: { vehicle: sale.vehicle, invoice: sale.invoice } },
      });
      // Keep original sold status and accounting dates. Never automatically return stock.
      await tx.update(vehiclesTable).set({ published: false, showroomRemoveAt: null })
        .where(and(eq(vehiclesTable.userId, userId), eq(vehiclesTable.id, sale.vehicleId)));
    });
    res.json(GetCancellationStateResponse.parse(await cancellationState(userId, params.data.id)));
  } catch (err) {
    const message = invoiceNumberError(err);
    if (message) { res.status(409).json({ error: message }); return; }
    throw err;
  }
});
router.post("/credits/:id/refunds", requireAdmin, async (req, res) => {
  const params = ConfirmSaleRefundParams.safeParse(req.params);
  const body = ConfirmSaleRefundBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid external refund confirmation." }); return; }
  const d = { ...body.data, reason: body.data.reason.trim(), method: body.data.method.trim().toLowerCase(), reference: body.data.reference.trim().toUpperCase(), recipient: body.data.recipient.trim() };
  const userId = req.userId!;
  if (!d.reason || !validDate(d.paymentDate) || !validMoney(d.amount) || d.amount <= 0 || !d.recipient.trim() || !d.method.trim() || !d.reference.trim()) {
    res.status(400).json({ error: "Enter the actual paid amount, non-future payment date, recipient, method and unique payment reference." }); return;
  }
  try {
    const refundId = await db.transaction(async tx => {
      await lockInvoiceNumbers(tx, userId);
      const [c] = await tx.select().from(saleCreditsTable).where(and(eq(saleCreditsTable.userId, userId), eq(saleCreditsTable.id, params.data.id)));
      if (!c) throw new InvoiceNumberConflict("Credit not found.");
      const [retry] = await tx.select().from(saleRefundsTable).where(and(eq(saleRefundsTable.userId, userId), eq(saleRefundsTable.requestKey, d.requestKey)));
      if (retry) {
        if (retry.reason === d.reason && retry.creditId === c.id && cents(retry.amount) === cents(d.amount) && retry.paymentDate === d.paymentDate && retry.recipient === d.recipient && retry.reference === d.reference && retry.method === d.method) return retry.id;
        throw new InvoiceNumberConflict("This confirmation key was already used with different payment details.");
      }
      const [duplicate] = await tx.select().from(saleRefundsTable).where(and(eq(saleRefundsTable.userId, userId), eq(saleRefundsTable.reference, d.reference)));
      if (duplicate) throw new InvoiceNumberConflict("This payment reference has already been confirmed. Do not record the same transfer twice.");
      if (d.paymentDate < c.cancellationDate) throw new InvoiceNumberConflict("Refund date cannot precede cancellation.");
      const balance = await refundBalance(userId, c.id, c.receivedAmount, tx);
      const [sale] = await tx.select().from(issuedSalesTable).where(and(eq(issuedSalesTable.id, c.issuedSaleId), eq(issuedSalesTable.userId, userId)));
      const [vehicle] = sale ? await tx.select().from(vehiclesTable).where(and(eq(vehiclesTable.id, sale.vehicleId), eq(vehiclesTable.userId, userId))).for("update") : [];
      if (!vehicle || vehicle.status !== "sold") throw new InvoiceNumberConflict("Refunds are only available for completed-sale vehicles still held in the vehicle records.");
      if (cents(d.amount) > cents(balance.due)) throw new InvoiceNumberConflict(`Refund exceeds the reconciled outstanding amount of £${balance.due.toFixed(2)}.`);
      const returnedVehicleId = cents(d.amount) === cents(balance.due)
        ? await returnRefundedStock(tx, vehicle, c.id, d.paymentDate, d.reason) : null;
      if (!returnedVehicleId) await tx.update(vehiclesTable).set({
        saleNotes: [vehicle.saleNotes, `Refund £${d.amount.toFixed(2)} on ${d.paymentDate}: ${d.reason}`].filter(Boolean).join("\n"),
      }).where(eq(vehiclesTable.id, vehicle.id));
      const [r] = await tx.insert(saleRefundsTable).values({ ...d, returnedVehicleId, amount: d.amount.toFixed(2), userId, creditId: c.id, actor: getSessionUserId(req)! }).returning();
      return r.id;
    });
    const entry = (await history(userId)).find(r => r.id === `refund-${refundId}`);
    res.json(ConfirmSaleRefundResponse.parse(entry));
  } catch (err) {
    const message = invoiceNumberError(err);
    if (message) { res.status(409).json({ error: message }); return; }
    throw err;
  }
});

export default router;
