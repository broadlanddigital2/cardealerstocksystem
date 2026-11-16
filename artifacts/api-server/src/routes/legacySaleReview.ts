import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db, vehiclesTable, invoicesTable, issuedSalesTable } from "@workspace/db";
import { ApproveLegacySaleReviewBody, ApproveLegacySaleReviewParams, ApproveLegacySaleReviewResponse } from "@workspace/api-zod";
import { requireAdmin, getSessionUserId } from "../middlewares/requireAuth";
import { lockInvoiceNumbers, InvoiceNumberConflict, invoiceNumberError, assertInvoiceNumberAvailable } from "../lib/invoiceNumbers";
import { cancellationState, snapshotIssuedSale, validDate, validMoney } from "../lib/saleLedger";
import { vehicleEditVersion, staleVehicleMessage } from "../lib/vehicleEditVersion";

const router = Router();
router.post("/vehicles/:id/accounting-review", requireAdmin, async (req, res) => {
  const params = ApproveLegacySaleReviewParams.safeParse(req.params);
  const parsed = ApproveLegacySaleReviewBody.safeParse(req.body);
  if (!params.success || !parsed.success) { res.status(400).json({ error: "Enter the refund reason and approve the details." }); return; }
  const refundReason = parsed.data.refundReason?.trim();
  const d = { ...parsed.data, documentReference: parsed.data.documentReference?.trim() ?? "",
    notes: refundReason ? `Refund reason: ${refundReason}` : parsed.data.notes?.trim() ?? "" };
  if (!d.confirmed || (parsed.data.refundReason !== undefined ? !refundReason : !d.documentReference || !d.notes)) {
    res.status(400).json({ error: "Approve the details and enter a reason for the refund." }); return;
  }
  const userId = req.userId!;
  try {
    await db.transaction(async tx => {
      await lockInvoiceNumbers(tx, userId);
      const [issued] = await tx.select().from(issuedSalesTable).where(and(eq(issuedSalesTable.userId, userId), eq(issuedSalesTable.vehicleId, params.data.id)));
      if (issued) {
        const evidence = issued.reviewEvidence;
        if (evidence?.expectedEditVersion === d.expectedEditVersion && evidence.documentReference === d.documentReference && evidence.notes === d.notes) return;
        throw new InvoiceNumberConflict("This sale already has retained accounting. Its original review cannot be replaced.");
      }
      const [vehicle] = await tx.select().from(vehiclesTable).where(and(eq(vehiclesTable.userId, userId), eq(vehiclesTable.id, params.data.id))).for("update");
      const [invoice] = await tx.select().from(invoicesTable).where(and(eq(invoicesTable.userId, userId), eq(invoicesTable.vehicleId, params.data.id)));
      if (!vehicle || vehicle.status !== "sold" || !invoice) throw new InvoiceNumberConflict("Only a completed sale with its saved invoice can be reviewed. Recover any missing invoice first.");
      if (vehicleEditVersion(vehicle, invoice) !== d.expectedEditVersion) throw new InvoiceNumberConflict(staleVehicleMessage);
      if (!validDate(vehicle.purchaseDate) || !vehicle.saleDate || !validDate(vehicle.saleDate) ||
          vehicle.purchaseDate > vehicle.saleDate || invoice.invoiceDate !== vehicle.saleDate ||
          invoice.invoiceNumber !== vehicle.salesInvoiceNumber ||
          vehicle.salePrice == null || Number(invoice.salePrice) !== Number(vehicle.salePrice) ||
          Number(invoice.saleVat ?? 0) !== Number(vehicle.saleVat ?? 0) ||
          Number(invoice.holdingDeposit ?? 0) !== Number(vehicle.holdingDepositAmount ?? 0) ||
          Number(invoice.partExchangeAllowance ?? 0) !== Number(vehicle.partExchangeAllowance ?? 0) ||
          ![vehicle.purchasePrice, vehicle.purchaseVat ?? 0, vehicle.auctionCostNoVat ?? 0, vehicle.auctionCostWithVat ?? 0].every(n => validMoney(Number(n)))) {
        throw new InvoiceNumberConflict("The saved invoice and vehicle figures are incomplete or inconsistent. Correct them against the original documents before approving this review.");
      }
      await assertInvoiceNumberAvailable(tx, userId, vehicle.id, invoice.invoiceNumber);
      await snapshotIssuedSale(tx, vehicle, invoice, getSessionUserId(req)!, {
        documentReference: d.documentReference, notes: d.notes, expectedEditVersion: d.expectedEditVersion,
      });
    });
    res.json(ApproveLegacySaleReviewResponse.parse(await cancellationState(userId, params.data.id)));
  } catch (err) {
    const message = invoiceNumberError(err);
    if (message) { res.status(409).json({ error: message }); return; }
    throw err;
  }
});
export default router;
