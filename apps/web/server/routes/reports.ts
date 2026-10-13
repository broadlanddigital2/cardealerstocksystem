import { Router } from "../http";
import { requireModule } from "../lib/modules";
import { eq, and, desc, isNotNull } from "@workspace/db";
import { db, vehiclesTable, depositRefundsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { serializeVehicle } from "../lib/vehicleSerializer";

const router = new Router();

router.use("/reports", requireAuth, requireModule("reports"));

router.get("/reports/stock", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const date = (req.query.date as string | undefined) ?? "";
  if (!date) {
    res.status(400).json({ error: "date query parameter is required" });
    return;
  }
  const rows = await db
    .select()
    .from(vehiclesTable)
    .where(eq(vehiclesTable.userId, userId));

  // In stock at date = purchased on/before date AND (not sold OR sold after date).
  const inStock = rows.filter((r) => {
    if (r.purchaseDate > date) return false;
    if (r.status === "sold" && r.saleDate && r.saleDate <= date) return false;
    return true;
  });

  res.json(inStock.map((r) => serializeVehicle(r)));
});

router.get("/reports/purchases", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const rows = await db
    .select()
    .from(vehiclesTable)
    .where(eq(vehiclesTable.userId, userId));

  const filtered = rows.filter((r) => {
    if (from && r.purchaseDate < from) return false;
    if (to && r.purchaseDate > to) return false;
    return true;
  });
  filtered.sort((a, b) => (a.purchaseDate < b.purchaseDate ? -1 : 1));
  res.json(filtered.map((r) => serializeVehicle(r)));
});

router.get("/reports/sales", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const rows = await db
    .select()
    .from(vehiclesTable)
    .where(and(eq(vehiclesTable.userId, userId), eq(vehiclesTable.status, "sold")));

  const filtered = rows.filter((r) => {
    if (!r.saleDate) return false;
    if (from && r.saleDate < from) return false;
    if (to && r.saleDate > to) return false;
    return true;
  });
  filtered.sort((a, b) => ((a.saleDate ?? "") < (b.saleDate ?? "") ? -1 : 1));
  res.json(filtered.map((r) => serializeVehicle(r)));
});

router.get("/reports/deposits", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;

  const [held, refunds] = await Promise.all([
    db
      .select()
      .from(vehiclesTable)
      .where(
        and(
          eq(vehiclesTable.userId, userId),
          isNotNull(vehiclesTable.holdingDepositAmount),
        ),
      ),
    db
      .select()
      .from(depositRefundsTable)
      .where(eq(depositRefundsTable.userId, userId)),
  ]);

  type Entry = {
    id: string;
    type: "received" | "refunded";
    vehicleId: number;
    stockNumber: string;
    registrationNumber: string;
    make: string;
    model: string;
    buyerName: string | null;
    reference: string | null;
    amount: number;
    date: string | null;
  };

  const entries: Entry[] = [];

  // Deposits currently held on a vehicle (reserved or carried into a sale).
  for (const v of held) {
    entries.push({
      id: `received-v${v.id}`,
      type: "received",
      vehicleId: v.id,
      stockNumber: v.stockNumber,
      registrationNumber: v.registrationNumber,
      make: v.make,
      model: v.model,
      buyerName: v.buyerName ?? null,
      reference: v.holdingDepositReference ?? null,
      amount: Number(v.holdingDepositAmount),
      date: v.holdingDepositDate ?? null,
    });
  }

  // Refunded deposits: each was received once and refunded once.
  for (const r of refunds) {
    entries.push({
      id: `received-r${r.id}`,
      type: "received",
      vehicleId: r.vehicleId,
      stockNumber: r.stockNumber,
      registrationNumber: r.registrationNumber,
      make: r.make,
      model: r.model,
      buyerName: r.buyerName ?? null,
      reference: r.depositReference ?? null,
      amount: Number(r.depositAmount),
      date: r.depositDate ?? null,
    });
    entries.push({
      id: `refunded-r${r.id}`,
      type: "refunded",
      vehicleId: r.vehicleId,
      stockNumber: r.stockNumber,
      registrationNumber: r.registrationNumber,
      make: r.make,
      model: r.model,
      buyerName: r.buyerName ?? null,
      reference: r.depositReference ?? null,
      amount: Number(r.depositAmount),
      date: r.refundDate,
    });
  }

  const filtered = entries.filter((e) => {
    if (!e.date) return false;
    if (from && e.date < from) return false;
    if (to && e.date > to) return false;
    return true;
  });

  filtered.sort((a, b) => ((a.date ?? "") < (b.date ?? "") ? 1 : -1));

  res.json(filtered);
});

export default router;
