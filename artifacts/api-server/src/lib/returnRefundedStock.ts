import { and, eq, inArray } from "drizzle-orm";
import { vehiclesTable, type Vehicle } from "@workspace/db";
import { InvoiceNumberConflict } from "./invoiceNumbers";
import type { db } from "@workspace/db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Caller holds the dealer accounting lock. Preserve original sale identity. */
export async function returnRefundedStock(tx: Tx, original: Vehicle, creditId: number, date: string, reason: string) {
  const [duplicate] = await tx.select({ id: vehiclesTable.id }).from(vehiclesTable).where(and(
    eq(vehiclesTable.userId, original.userId),
    eq(vehiclesTable.registrationNumber, original.registrationNumber),
    inArray(vehiclesTable.status, ["in_stock", "reserved"]),
  ));
  if (duplicate) throw new InvoiceNumberConflict("This registration is already in stock. Resolve the duplicate before recording the full refund.");
  const note = `Returned after full refund on ${date}. Original stock ${original.stockNumber}. Refund reason: ${reason}`;
  const [returned] = await tx.insert(vehiclesTable).values({
    userId: original.userId,
    stockNumber: `${original.stockNumber}-R${creditId}`,
    purchaseNumber: `${original.purchaseNumber}-R${creditId}`,
    registrationNumber: original.registrationNumber, make: original.make, model: original.model,
    vin: original.vin, colour: original.colour, description: original.description,
    mileageAtPurchase: original.mileageAtSale ?? original.mileageAtPurchase,
    purchaseDate: original.purchaseDate, purchaseType: original.purchaseType,
    sellerName: original.sellerName, sellerAddress: original.sellerAddress,
    purchasePrice: original.purchasePrice, purchaseVat: original.purchaseVat,
    vatQualifying: original.vatQualifying, auctionCostNoVat: original.auctionCostNoVat,
    auctionCostWithVat: original.auctionCostWithVat,
    purchaseInvoiceNumber: original.purchaseInvoiceNumber,
    purchaseDocumentReference: original.purchaseDocumentReference,
    purchaseNotes: note, returnedFromVehicleId: original.id, stockReturnDate: date,
    status: "in_stock", published: false, showroomSold: false, showroomRemoveAt: null,
    photoUrls: original.photoUrls, askingPrice: original.askingPrice,
    marketingDescription: original.marketingDescription,
  }).returning();
  await tx.update(vehiclesTable).set({
    saleNotes: [original.saleNotes, `${note}. Returned stock: ${returned.stockNumber}`].filter(Boolean).join("\n"),
    published: false, showroomSold: false, showroomRemoveAt: null,
  }).where(eq(vehiclesTable.id, original.id));
  return returned.id;
}
