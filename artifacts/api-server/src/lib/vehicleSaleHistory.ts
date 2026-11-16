import type { IssuedSale, SaleCredit, SaleRefund, Vehicle } from "@workspace/db";
import type { VehicleSaleHistoryEvent } from "@workspace/api-zod";
import { issuedAmounts } from "./saleLedger";
import type { vehicleRevisionsTable } from "@workspace/db";

/** Inputs must all be tenant-scoped. Read only: never repair or infer links by registration. */
export function vehicleSaleHistory(id: number, vehicles: Vehicle[], sales: IssuedSale[], credits: SaleCredit[], refunds: SaleRefund[], revisions: (typeof vehicleRevisionsTable.$inferSelect)[]): VehicleSaleHistoryEvent[] | null {
  const live = new Map(vehicles.map(v => [v.id, v]));
  const snapshots = new Map(sales.map(s => [s.vehicleId, s.vehicle]));
  const saleById = new Map(sales.map(s => [s.id, s]));
  const creditById = new Map(credits.map(c => [c.id, c]));
  const edges: Array<[number, number]> = [];
  for (const v of [...snapshots.values(), ...vehicles]) {
    if (v.returnedFromVehicleId) edges.push([v.returnedFromVehicleId, v.id]);
  }
  for (const r of refunds) {
    const sale = saleById.get(creditById.get(r.creditId)?.issuedSaleId ?? -1);
    if (sale && r.returnedVehicleId) edges.push([sale.vehicleId, r.returnedVehicleId]);
  }
  if (!live.has(id) && !snapshots.has(id) && !edges.some(e => e.includes(id))) return null;
  const linked = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [a, b] of edges) if (linked.has(a) || linked.has(b)) {
      if (!linked.has(a) || !linked.has(b)) changed = true;
      linked.add(a); linked.add(b);
    }
  }
  const stock = (vehicleId: number) => {
    const v = snapshots.get(vehicleId) ?? live.get(vehicleId);
    return { vehicleId, vehicleAvailable: live.has(vehicleId),
      stockLabel: v ? `${v.stockNumber} / ${v.registrationNumber}` : `Stock record #${vehicleId}` };
  };
  const events: VehicleSaleHistoryEvent[] = [];
  for (const s of sales.filter(s => s.reviewEvidence && linked.has(s.vehicleId))) {
    events.push({ ...stock(s.vehicleId), id: `review-${s.id}`, type: "review",
      date: s.createdAt.toISOString().slice(0, 10), recordedAt: s.createdAt.toISOString(),
      documentNumber: s.invoiceNumber, actor: s.actor,
      reason: `Original documents verified: ${s.reviewEvidence!.documentReference}\n${s.reviewEvidence!.notes}`,
      originalDocument: JSON.stringify({ invoice: s.invoice, vehicle: s.vehicle, review: s.reviewEvidence }),
    });
  }
  for (const s of sales.filter(s => linked.has(s.vehicleId))) {
    events.push({ ...stock(s.vehicleId), id: `sale-${s.id}`, type: "sale",
      date: s.invoice.invoiceDate, recordedAt: s.createdAt.toISOString(),
      documentNumber: s.invoiceNumber, reason: "Original retained issuance",
      amount: issuedAmounts(s.vehicle, s.invoice).gross, actor: s.actor });
    for (const c of credits.filter(c => c.issuedSaleId === s.id)) {
      const frozen = c.request.accountingSnapshot as { vehicle?: IssuedSale["vehicle"]; invoice?: IssuedSale["invoice"] } | undefined;
      events.push({ ...stock(s.vehicleId), id: `credit-${c.id}`, type: "credit",
        date: c.cancellationDate, recordedAt: c.createdAt.toISOString(), documentNumber: c.creditNumber,
        reason: c.reason, actor: c.actor,
        amount: -issuedAmounts(frozen?.vehicle ?? s.vehicle, frozen?.invoice ?? s.invoice).gross });
      for (const r of refunds.filter(r => r.creditId === c.id)) {
        events.push({ ...stock(s.vehicleId), id: `refund-${r.id}`, type: "refund",
          date: r.paymentDate, recordedAt: r.createdAt.toISOString(), documentNumber: c.creditNumber,
          reason: r.reason ?? c.reason, amount: Number(r.amount), actor: r.actor,
          recipient: r.recipient, reference: r.reference, method: r.method });
        if (r.returnedVehicleId) {
          const v = live.get(r.returnedVehicleId) ?? snapshots.get(r.returnedVehicleId);
          events.push({ ...stock(r.returnedVehicleId), id: `return-${r.returnedVehicleId}`, type: "returned_stock",
            date: v?.stockReturnDate ?? r.paymentDate, recordedAt: r.createdAt.toISOString(),
            documentNumber: c.creditNumber, reason: r.reason ?? c.reason, actor: r.actor });
        }
      }
    }
  }
  for (const v of [...snapshots.values(), ...vehicles]) {
    if (linked.has(v.id) && v.returnedFromVehicleId && !events.some(e => e.id === `return-${v.id}`)) {
      events.push({ ...stock(v.id), id: `return-${v.id}`, type: "returned_stock",
        date: v.stockReturnDate ?? "", recordedAt: "", documentNumber: "",
        reason: `Returned from stock record #${v.returnedFromVehicleId}` });
    }
  }
  for (const r of revisions.filter(r => linked.has(r.vehicleId))) {
    events.push({ ...stock(r.vehicleId), id: `correction-${r.id}`, type: "correction",
      date: r.createdAt.toISOString().slice(0, 10), recordedAt: r.createdAt.toISOString(),
      documentNumber: r.afterInvoice?.invoiceNumber ?? "", actor: r.actor,
      reason: "Audited correction, not an additional sale or payment. Credits retain the accounting figures approved at cancellation.",
      previousAmount: r.beforeInvoice ? issuedAmounts(r.beforeVehicle, r.beforeInvoice).gross : undefined,
      correctedAmount: r.afterInvoice ? issuedAmounts(r.afterVehicle, r.afterInvoice).gross : undefined,
      originalDocument: JSON.stringify({ beforeVehicle: r.beforeVehicle, afterVehicle: r.afterVehicle,
        beforeInvoice: r.beforeInvoice, afterInvoice: r.afterInvoice }),
    });
  }
  const order = { sale: 0, review: 1, correction: 2, credit: 3, refund: 4, returned_stock: 5 };
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.recordedAt.localeCompare(b.recordedAt) || order[a.type] - order[b.type] || a.id.localeCompare(b.id));
}
