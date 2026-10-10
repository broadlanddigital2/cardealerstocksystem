import { Router } from "../http";
import { and, eq, desc } from "@workspace/db";
import { db, cashExpensesTable } from "@workspace/db";
import {
  CreateCashExpenseBody,
  DeleteCashExpenseParams,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";

const router = new Router();

router.use("/cash-expenses", requireAuth);

function serialize(row: typeof cashExpensesTable.$inferSelect) {
  return {
    id: row.id,
    date: row.date,
    description: row.description,
    amount: Number(row.amount),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

router.get("/cash-expenses", async (req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(cashExpensesTable)
    .where(eq(cashExpensesTable.userId, req.userId!))
    .orderBy(desc(cashExpensesTable.date), desc(cashExpensesTable.createdAt));
  res.json(rows.map(serialize));
});

router.post("/cash-expenses", async (req, res): Promise<void> => {
  const parsed = CreateCashExpenseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const d = parsed.data;
  const description = d.description.trim();
  if (!description) {
    res.status(400).json({ error: "Description is required." });
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date) || Number.isNaN(Date.parse(d.date))) {
    res.status(400).json({ error: "Date must be a valid YYYY-MM-DD date." });
    return;
  }
  if (!Number.isFinite(d.amount) || d.amount <= 0) {
    res.status(400).json({ error: "Amount must be greater than zero." });
    return;
  }
  const [row] = await db
    .insert(cashExpensesTable)
    .values({
      userId: req.userId!,
      date: d.date,
      description,
      amount: String(d.amount),
    })
    .returning();
  res.status(201).json(serialize(row));
});

router.delete("/cash-expenses/:id", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const params = DeleteCashExpenseParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const id = params.data.id;
  const [row] = await db
    .delete(cashExpensesTable)
    .where(
      and(eq(cashExpensesTable.id, id), eq(cashExpensesTable.userId, userId)),
    )
    .returning();
  if (!row) {
    res.status(404).json({ error: "Cash expense not found." });
    return;
  }
  res.status(204).send();
});

export default router;
