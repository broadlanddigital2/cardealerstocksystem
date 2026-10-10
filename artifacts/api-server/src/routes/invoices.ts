import { Router, type IRouter } from "express";
import { and, eq, desc } from "drizzle-orm";
import { db, invoicesTable, vehiclesTable } from "@workspace/db";
import {
  CreateVehicleInvoiceBody,
  CreateVehicleInvoiceParams,
  GetInvoiceParams,
  GetVehicleInvoiceParams,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { serializeInvoice } from "../lib/vehicleSerializer";

const router: IRouter = Router();

router.use("/invoices", requireAuth);
router.use("/vehicles/:id/invoice", requireAuth);

async function nextInvoiceNumber(userId: string): Promise<string> {
  const rows = await db
    .select({ invoiceNumber: invoicesTable.invoiceNumber })
    .from(invoicesTable)
    .where(eq(invoicesTable.userId, userId));
  let max = 0;
  for (const r of rows) {
    const n = parseInt(String(r.invoiceNumber).replace(/\D/g, ""), 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return `INV-${String(max + 1).padStart(4, "0")}`;
}

router.get("/invoices/next-number", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const invoiceNumber = await nextInvoiceNumber(userId);
  res.json({ invoiceNumber });
});

router.get("/invoices", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const rows = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.userId, userId))
    .orderBy(desc(invoicesTable.createdAt));
  res.json(rows.map(serializeInvoice));
});

router.get("/invoices/:id", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const params = GetInvoiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select()
    .from(invoicesTable)
    .where(
      and(eq(invoicesTable.id, params.data.id), eq(invoicesTable.userId, userId)),
    );
  if (!row) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  res.json(serializeInvoice(row));
});

router.get("/vehicles/:id/invoice", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const params = GetVehicleInvoiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select()
    .from(invoicesTable)
    .where(
      and(
        eq(invoicesTable.vehicleId, params.data.id),
        eq(invoicesTable.userId, userId),
      ),
    )
    .orderBy(desc(invoicesTable.createdAt));
  if (!row) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  res.json(serializeInvoice(row));
});

router.post("/vehicles/:id/invoice", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const params = CreateVehicleInvoiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreateVehicleInvoiceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [vehicle] = await db
    .select()
    .from(vehiclesTable)
    .where(
      and(
        eq(vehiclesTable.id, params.data.id),
        eq(vehiclesTable.userId, userId),
      ),
    );
  if (!vehicle) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }

  const d = parsed.data;

  // Rule: the balance payable can never be negative (deposit and/or
  // part-exchange allowance cannot exceed the sale price).
  if (Number(d.balancePayable) < 0) {
    res.status(400).json({
      error:
        "Balance payable cannot be negative — the holding deposit and part-exchange allowance cannot exceed the sale price.",
    });
    return;
  }

  try {
    const [row] = await db
      .insert(invoicesTable)
      .values({
        userId,
        vehicleId: params.data.id,
        invoiceNumber: d.invoiceNumber,
        invoiceDate: d.invoiceDate,
        customerName: d.customerName,
        customerAddress: d.customerAddress,
        salePrice: String(d.salePrice),
        saleVat: d.saleVat != null ? String(d.saleVat) : null,
        paymentMethod: d.paymentMethod ?? null,
        partExchangeAllowance:
          d.partExchangeAllowance != null
            ? String(d.partExchangeAllowance)
            : null,
        balancePayable: String(d.balancePayable),
        holdingDeposit:
          d.holdingDeposit != null ? String(d.holdingDeposit) : null,
        extras: d.extras ?? null,
        // Per-item flags drive finance-invoice inclusion now; keep the legacy
        // invoice-level flag in sync (true when any extra is on finance) so older
        // read paths and fallbacks stay consistent.
        extrasOnFinanceInvoice:
          (d.extras ?? []).some((e) => e.onFinanceInvoice) ||
          (d.extrasOnFinanceInvoice ?? false),
        notes: d.notes ?? null,
        financeCompanyName: d.financeCompanyName ?? null,
        financeCompanyAddress: d.financeCompanyAddress ?? null,
        financeCompanyEmail: d.financeCompanyEmail ?? null,
      })
      .returning();

    res.status(201).json(serializeInvoice(row));
  } catch (err) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as { code?: string }).code === "23505"
    ) {
      res
        .status(400)
        .json({ error: "Invoice number already exists. Choose another." });
      return;
    }
    throw err;
  }
});

export default router;
