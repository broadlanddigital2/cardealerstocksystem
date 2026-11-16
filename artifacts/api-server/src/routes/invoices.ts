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
import { invoiceValues } from "../lib/invoiceValues";
import { nextInvoiceNumber, lockInvoiceNumbers, assertInvoiceNumberAvailable, invoiceNumberError, InvoiceNumberConflict } from "../lib/invoiceNumbers";

const router: IRouter = Router();

router.use("/invoices", requireAuth);
router.use("/vehicles/:id/invoice", requireAuth);

router.get("/invoices/next-number", async (req, res): Promise<void> => {
  const userId = req.userId!;
  // Preview only: a number is reserved only by the sale transaction.
  const invoiceNumber = await nextInvoiceNumber(db, userId);
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

  try {
    const row = await db.transaction(async (tx) => {
      await lockInvoiceNumbers(tx, userId);
      const [current] = await tx.select().from(vehiclesTable).where(and(
        eq(vehiclesTable.id, params.data.id), eq(vehiclesTable.userId, userId),
      )).for("update");
      if (!current?.salesInvoiceNumber)
        throw new InvoiceNumberConflict("Record the sale before creating its invoice. Refresh this vehicle and try again.");
      const invoiceNumber = current.salesInvoiceNumber;
      await assertInvoiceNumberAvailable(tx, userId, current.id, invoiceNumber);
      const [issued] = await tx.select().from(invoicesTable).where(and(
        eq(invoicesTable.userId, userId), eq(invoicesTable.vehicleId, current.id),
        eq(invoicesTable.invoiceNumber, invoiceNumber),
      ));
      if (issued) return issued; // Safe retry after a lost response.
      const [created] = await tx
      .insert(invoicesTable)
      .values(invoiceValues(userId, params.data.id, { ...d, invoiceNumber }))
      .returning();
      return created;
    });

    res.status(201).json(serializeInvoice(row));
  } catch (err) {
    const message = invoiceNumberError(err);
    if (message) {
      res.status(409).json({ error: message });
      return;
    }
    throw err;
  }
});

export default router;
