import { Router } from "../http";
import { requireModule } from "../lib/modules";
import { and, eq, desc } from "@workspace/db";
import { db, sellersTable } from "@workspace/db";
import {
  CreateSellerBody,
  UpdateSellerBody,
  UpdateSellerParams,
  DeleteSellerParams,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";

const router = new Router();

router.use("/sellers", requireAuth, requireModule("contacts"));

function serialize(row: typeof sellersTable.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    contactName: row.contactName,
    address: row.address,
    phone: row.phone,
    email: row.email,
    vatNumber: row.vatNumber,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

router.get("/sellers", async (req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(sellersTable)
    .where(eq(sellersTable.userId, req.userId!))
    .orderBy(desc(sellersTable.createdAt));
  res.json(rows.map(serialize));
});

router.post("/sellers", async (req, res): Promise<void> => {
  const parsed = CreateSellerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const d = parsed.data;
  const [row] = await db
    .insert(sellersTable)
    .values({
      userId: req.userId!,
      name: d.name,
      contactName: d.contactName ?? null,
      address: d.address ?? null,
      phone: d.phone ?? null,
      email: d.email ?? null,
      vatNumber: d.vatNumber ?? null,
      notes: d.notes ?? null,
    })
    .returning();
  res.status(201).json(serialize(row));
});

router.patch("/sellers/:id", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const params = UpdateSellerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const id = params.data.id;
  const parsed = UpdateSellerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const d = parsed.data;
  const update: Record<string, unknown> = {};
  for (const key of [
    "name",
    "contactName",
    "address",
    "phone",
    "email",
    "vatNumber",
    "notes",
  ] as const) {
    if (key in d) update[key] = (d as Record<string, unknown>)[key];
  }

  const [row] = await db
    .update(sellersTable)
    .set(update)
    .where(and(eq(sellersTable.id, id), eq(sellersTable.userId, userId)))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Seller not found." });
    return;
  }
  res.json(serialize(row));
});

router.delete("/sellers/:id", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const params = DeleteSellerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const id = params.data.id;
  const [row] = await db
    .delete(sellersTable)
    .where(and(eq(sellersTable.id, id), eq(sellersTable.userId, userId)))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Seller not found." });
    return;
  }
  res.status(204).send();
});

export default router;
