import { Router } from "../http";
import { requireModule } from "../lib/modules";
import { and, eq, desc, inArray } from "@workspace/db";
import { db, enquiriesTable, vehiclesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";

// Authenticated, dealer-facing view of customer enquiries (leads) captured by
// the public showroom. Scoped to the shared dealer tenant via requireAuth.
const router = new Router();

router.use("/enquiries", requireAuth, requireModule("leads"));

const ALLOWED_STATUSES = new Set(["new", "read", "archived"]);

// GET /enquiries — all leads, newest first, with light vehicle context for
// display. Registration is included here because this surface is dealer-only.
router.get("/enquiries", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const enquiries = await db
    .select({
      id: enquiriesTable.id,
      vehicleId: enquiriesTable.vehicleId,
      name: enquiriesTable.name,
      email: enquiriesTable.email,
      phone: enquiriesTable.phone,
      message: enquiriesTable.message,
      notes: enquiriesTable.notes,
      status: enquiriesTable.status,
      createdAt: enquiriesTable.createdAt,
    })
    .from(enquiriesTable)
    .where(eq(enquiriesTable.userId, userId))
    .orderBy(desc(enquiriesTable.createdAt));

  // Vehicle context for each lead (previously a LEFT JOIN).
  const vehicleIds = [...new Set(enquiries.map((e) => e.vehicleId).filter((id): id is number => id != null))];
  const vehicles = vehicleIds.length
    ? await db
        .select({
          id: vehiclesTable.id,
          make: vehiclesTable.make,
          model: vehiclesTable.model,
          registrationNumber: vehiclesTable.registrationNumber,
        })
        .from(vehiclesTable)
        .where(inArray(vehiclesTable.id, vehicleIds))
    : [];
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]));
  const rows = enquiries.map((e) => {
    const v = e.vehicleId != null ? vehicleById.get(e.vehicleId) : undefined;
    return {
      ...e,
      vehicleMake: v?.make ?? null,
      vehicleModel: v?.model ?? null,
      vehicleRegistration: v?.registrationNumber ?? null,
    };
  });

  res.json(
    rows.map((r) => ({
      id: r.id,
      vehicleId: r.vehicleId,
      name: r.name,
      email: r.email,
      phone: r.phone,
      message: r.message,
      notes: r.notes,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      vehicle: r.vehicleId
        ? {
            id: r.vehicleId,
            make: r.vehicleMake,
            model: r.vehicleModel,
            registrationNumber: r.vehicleRegistration,
          }
        : null,
    })),
  );
});

// PATCH /enquiries/:id — update the lead's status (new | read | archived)
// and/or the dealer's internal note. At least one field must be supplied.
const MAX_NOTES_LENGTH = 2000;

router.patch("/enquiries/:id", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid enquiry id" });
    return;
  }

  const body = req.body ?? {};
  const update: { status?: string; notes?: string | null } = {};

  if (body.status !== undefined) {
    if (typeof body.status !== "string" || !ALLOWED_STATUSES.has(body.status)) {
      res.status(400).json({ error: "Invalid status" });
      return;
    }
    update.status = body.status;
  }

  if (body.notes !== undefined) {
    if (body.notes !== null && typeof body.notes !== "string") {
      res.status(400).json({ error: "Invalid notes" });
      return;
    }
    if (typeof body.notes === "string" && body.notes.length > MAX_NOTES_LENGTH) {
      res.status(400).json({ error: "Notes too long" });
      return;
    }
    const trimmed = typeof body.notes === "string" ? body.notes.trim() : null;
    update.notes = trimmed ? trimmed : null;
  }

  if (Object.keys(update).length === 0) {
    res.status(400).json({ error: "Nothing to update" });
    return;
  }

  const [updated] = await db
    .update(enquiriesTable)
    .set(update)
    .where(and(eq(enquiriesTable.id, id), eq(enquiriesTable.userId, userId)))
    .returning({ id: enquiriesTable.id });
  if (!updated) {
    res.status(404).json({ error: "Enquiry not found" });
    return;
  }

  res.json({ ok: true });
});

export default router;
