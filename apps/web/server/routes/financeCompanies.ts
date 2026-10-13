import { Router } from "../http";
import { requireModule } from "../lib/modules";
import { and, eq, desc } from "@workspace/db";
import { db, financeCompaniesTable } from "@workspace/db";
import {
  CreateFinanceCompanyBody,
  UpdateFinanceCompanyBody,
  UpdateFinanceCompanyParams,
  DeleteFinanceCompanyParams,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";

const router = new Router();

router.use("/finance-companies", requireAuth, requireModule("contacts", "finance_sales"));

function serialize(row: typeof financeCompaniesTable.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    email: row.email,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

router.get("/finance-companies", async (req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(financeCompaniesTable)
    .where(eq(financeCompaniesTable.userId, req.userId!))
    .orderBy(desc(financeCompaniesTable.createdAt));
  res.json(rows.map(serialize));
});

router.post("/finance-companies", async (req, res): Promise<void> => {
  const parsed = CreateFinanceCompanyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const d = parsed.data;
  const [row] = await db
    .insert(financeCompaniesTable)
    .values({
      userId: req.userId!,
      name: d.name,
      address: d.address ?? null,
      email: d.email ?? null,
    })
    .returning();
  res.status(201).json(serialize(row));
});

router.patch("/finance-companies/:id", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const params = UpdateFinanceCompanyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const id = params.data.id;
  const parsed = UpdateFinanceCompanyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const d = parsed.data;
  const update: Record<string, unknown> = {};
  for (const key of ["name", "address", "email"] as const) {
    if (key in d) update[key] = (d as Record<string, unknown>)[key];
  }
  if (Object.keys(update).length === 0) {
    res.status(400).json({ error: "No fields to update." });
    return;
  }

  const [row] = await db
    .update(financeCompaniesTable)
    .set(update)
    .where(
      and(
        eq(financeCompaniesTable.id, id),
        eq(financeCompaniesTable.userId, userId),
      ),
    )
    .returning();
  if (!row) {
    res.status(404).json({ error: "Finance company not found." });
    return;
  }
  res.json(serialize(row));
});

router.delete("/finance-companies/:id", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const params = DeleteFinanceCompanyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const id = params.data.id;
  const [row] = await db
    .delete(financeCompaniesTable)
    .where(
      and(
        eq(financeCompaniesTable.id, id),
        eq(financeCompaniesTable.userId, userId),
      ),
    )
    .returning();
  if (!row) {
    res.status(404).json({ error: "Finance company not found." });
    return;
  }
  res.status(204).send();
});

export default router;
