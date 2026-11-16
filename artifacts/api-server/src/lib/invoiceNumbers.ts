import { and, eq, ne, sql } from "drizzle-orm";
import { db, invoicesTable, vehiclesTable, invoiceArchiveTable, issuedSalesTable, saleCreditsTable } from "@workspace/db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class InvoiceNumberConflict extends Error {}

/** All number writers must take this transaction-scoped, dealer-wide lock first.
 * Keep this same contract when sale + invoice creation become one transaction.
 */
export async function lockInvoiceNumbers(tx: Tx, userId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`invoice-numbers:${userId}`}, 0))`);
}

export async function nextInvoiceNumber(tx: Tx | typeof db, userId: string) {
  const invoices = await tx.select({ number: invoicesTable.invoiceNumber })
    .from(invoicesTable).where(eq(invoicesTable.userId, userId));
  const sales = await tx.select({ number: vehiclesTable.salesInvoiceNumber })
    .from(vehiclesTable).where(eq(vehiclesTable.userId, userId));
  const archived = await tx.select({ number: invoiceArchiveTable.invoiceNumber })
    .from(invoiceArchiveTable).where(eq(invoiceArchiveTable.userId, userId));
  let max = 0n;
  const issued = await tx.select({ number: issuedSalesTable.invoiceNumber }).from(issuedSalesTable).where(eq(issuedSalesTable.userId, userId));
  const credits = await tx.select({ number: saleCreditsTable.creditNumber }).from(saleCreditsTable).where(eq(saleCreditsTable.userId, userId));
  for (const { number } of [...invoices, ...sales, ...archived, ...issued, ...credits]) {
    const digits = number?.replace(/\D/g, "");
    if (digits && BigInt(digits) > max) max = BigInt(digits);
  }
  return `INV-${String(max + 1n).padStart(4, "0")}`;
}

/** Existing historical references are never renumbered automatically. */
export async function assertInvoiceNumberAvailable(tx: Tx, userId: string, vehicleId: number, number: string) {
  const [sale] = await tx.select({ id: vehiclesTable.id }).from(vehiclesTable).where(and(
    eq(vehiclesTable.userId, userId), eq(vehiclesTable.salesInvoiceNumber, number), ne(vehiclesTable.id, vehicleId),
  ));
  const [invoice] = await tx.select({ id: invoicesTable.id }).from(invoicesTable).where(and(
    eq(invoicesTable.userId, userId), eq(invoicesTable.invoiceNumber, number), ne(invoicesTable.vehicleId, vehicleId),
  ));
  const [archived] = await tx.select({ id: invoiceArchiveTable.id }).from(invoiceArchiveTable).where(and(
    eq(invoiceArchiveTable.userId, userId), eq(invoiceArchiveTable.invoiceNumber, number),
  ));
  const [credit] = await tx.select({ id: saleCreditsTable.id }).from(saleCreditsTable).where(and(eq(saleCreditsTable.userId, userId), eq(saleCreditsTable.creditNumber, number)));
  const [issued] = await tx.select({ id: issuedSalesTable.id }).from(issuedSalesTable).where(and(eq(issuedSalesTable.userId, userId), eq(issuedSalesTable.invoiceNumber, number), ne(issuedSalesTable.vehicleId, vehicleId)));
  if (sale || invoice || archived || credit || issued) throw new InvoiceNumberConflict(
    "This invoice number is already linked to another sale. Nothing was changed. Refresh and try again; historical duplicates need staff review.",
  );
}

export function invoiceNumberError(err: unknown): string | undefined {
  if (err instanceof InvoiceNumberConflict) return err.message;
  const e = err as { code?: string; cause?: unknown };
  if (e?.code === "23505" || e?.code === "40001" || e?.code === "40P01")
    return "Another member of staff saved a change at the same time. Refresh this vehicle and try again.";
  return e?.cause ? invoiceNumberError(e.cause) : undefined;
}
