import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, vehiclesTable, dealerSettingsTable, invoicesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { computeDashboardSummary } from "@workspace/report-calc";

const router: IRouter = Router();

router.use("/dashboard", requireAuth);

router.get("/dashboard/summary", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const rows = await db
    .select()
    .from(vehiclesTable)
    .where(eq(vehiclesTable.userId, userId))
    .orderBy(desc(vehiclesTable.createdAt));

  const [settings] = await db
    .select({ vatQuarter: dealerSettingsTable.vatQuarter })
    .from(dealerSettingsTable)
    .where(eq(dealerSettingsTable.userId, userId));

  // Standard VAT also includes the VAT charged on invoice extras (e.g. admin
  // fees, warranties) for invoices dated within the current month/VAT period.
  const invoiceRows = await db
    .select({
      invoiceNumber: invoicesTable.invoiceNumber,
      invoiceDate: invoicesTable.invoiceDate,
      extras: invoicesTable.extras,
    })
    .from(invoicesTable)
    .where(eq(invoicesTable.userId, userId));

  // All VAT box totals, margin figures and per-box breakdowns are computed by
  // the pure, unit-tested helper in @workspace/report-calc.
  const summary = computeDashboardSummary(
    rows,
    invoiceRows,
    new Date(),
    settings?.vatQuarter ?? null,
  );

  const recentActivity: Array<{
    id: string;
    type: string;
    vehicleId: number;
    stockNumber: string;
    registrationNumber: string;
    description: string;
    date: string;
    amount: number;
  }> = [];

  for (const r of rows) {
    const purchaseCost =
      Number(r.purchasePrice) +
      (r.auctionCostNoVat == null ? 0 : Number(r.auctionCostNoVat));
    recentActivity.push({
      id: `p-${r.id}`,
      type: "purchase",
      vehicleId: r.id,
      stockNumber: r.stockNumber,
      registrationNumber: r.registrationNumber,
      description: `Purchased ${r.make} ${r.model}`,
      date: r.purchaseDate,
      amount: purchaseCost,
    });
    if (r.status === "sold" && r.saleDate) {
      recentActivity.push({
        id: `s-${r.id}`,
        type: "sale",
        vehicleId: r.id,
        stockNumber: r.stockNumber,
        registrationNumber: r.registrationNumber,
        description: `Sold ${r.make} ${r.model}`,
        date: r.saleDate,
        amount: r.salePrice == null ? 0 : Number(r.salePrice),
      });
    }
  }
  recentActivity.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  res.json({
    ...summary,
    recentActivity: recentActivity.slice(0, 10),
  });
});

export default router;
