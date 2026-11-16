import { Router } from "../http";
import { eq } from "@workspace/db";
import { db, dealerSettingsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { computeDashboardSummary } from "@workspace/report-calc";
import { accountingSources, hydrateVehicle } from "../lib/saleLedger";
import { serializeVehicle, computeMargins } from "../lib/vehicleSerializer";

const router = new Router();

router.use("/dashboard", requireAuth);

router.get("/dashboard/summary", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const source = await accountingSources(userId);
  const rows = source.vehicles.filter(v => source.liveIds.has(v.id) || v.status === "sold");

  const [settings] = await db
    .select({ vatQuarter: dealerSettingsTable.vatQuarter })
    .from(dealerSettingsTable)
    .where(eq(dealerSettingsTable.userId, userId));

  // Standard VAT also includes the VAT charged on invoice extras (e.g. admin
  // fees, warranties) for invoices dated within the current month/VAT period.
  const invoiceRows = source.invoices;
  const credits = source.credits.map(c => {
    const s = source.issued.find(s => s.id === c.issuedSaleId)!;
    const v = serializeVehicle(hydrateVehicle(s.vehicle));
    return { creditNumber: c.creditNumber, date: c.cancellationDate,
      salePrice: v.salePrice ?? 0,
      margin: s.vehicle.issuedAccounting?.totalMargin ?? computeMargins(v.totalPurchaseCost, v.salePrice).margin ?? 0,
      marginVat: s.vehicle.issuedAccounting?.vatDue ?? v.vatDue ?? 0,
      standardVat: (v.vatQualifying ? v.saleVat ?? 0 : 0) + (s.invoice.extras ?? []).reduce((sum, e) => sum + (e.vat ?? 0), 0),
    };
  });

  // All VAT box totals, margin figures and per-box breakdowns are computed by
  // the pure, unit-tested helper in @workspace/report-calc.
  const summary = computeDashboardSummary(
    rows,
    invoiceRows,
    new Date(),
    settings?.vatQuarter ?? null,
    credits,
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
    if (r.returnedFromVehicleId == null) recentActivity.push({
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
