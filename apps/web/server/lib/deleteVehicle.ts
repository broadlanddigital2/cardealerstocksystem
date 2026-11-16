import { and, eq } from "@workspace/db";
import { db, vehiclesTable, invoicesTable, invoiceArchiveTable } from "@workspace/db";
import { lockInvoiceNumbers } from "./invoiceNumbers";

/** Archive before removing live rows, atomically under the allocation lock.
 * Deletion is not a credit note, refund, or cancellation of the original sale.
 */
export async function deleteVehicleWithArchive(userId: string, vehicleId: number) {
  return db.transaction(async tx => {
    await lockInvoiceNumbers(tx, userId);
    const scope = and(eq(vehiclesTable.userId, userId), eq(vehiclesTable.id, vehicleId));
    const [vehicle] = await tx.select().from(vehiclesTable).where(scope).for("update");
    if (!vehicle) return false;
    const invoiceScope = and(eq(invoicesTable.userId, userId), eq(invoicesTable.vehicleId, vehicleId));
    const invoices = await tx.select().from(invoicesTable).where(invoiceScope);
    for (const invoice of invoices) {
      await tx.insert(invoiceArchiveTable).values({
        userId, vehicleId, invoiceNumber: invoice.invoiceNumber,
        invoiceSnapshot: invoice, vehicleSnapshot: vehicle,
      });
    }
    // Incomplete sales and mismatched legacy references must also stay reserved.
    if (vehicle.salesInvoiceNumber && !invoices.some(i => i.invoiceNumber === vehicle.salesInvoiceNumber)) {
      await tx.insert(invoiceArchiveTable).values({
        userId, vehicleId, invoiceNumber: vehicle.salesInvoiceNumber,
        invoiceSnapshot: null, vehicleSnapshot: vehicle,
      });
    }
    await tx.delete(invoicesTable).where(invoiceScope);
    await tx.delete(vehiclesTable).where(scope);
    return true;
  });
}
