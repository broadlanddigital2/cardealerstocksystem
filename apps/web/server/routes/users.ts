import { Router } from "../http";
import { roleExists } from "../lib/modules";
import { eq } from "@workspace/db";
import { db, appUsersTable, dealerSettingsTable } from "@workspace/db";
import { CreateAppUserBody, UpdateAppUserBody } from "@workspace/api-zod";
import {
  requireAdmin,
  getSessionUserId,
  getUserEmail,
  bustUserCache,
} from "../middlewares/requireAuth";
import { sendInviteEmail } from "../lib/email";
import { logger } from "../lib/logger";

// Admin-managed access list. Lets admins invite users (by email) and set each
// one's permission level (admin | user). The hardcoded operator
// (chris.swinton@swintonaccountants.co.uk) is always an admin and is shown as a
// locked row that cannot be edited or removed from here. Admins also cannot
// change or remove their OWN row through this UI, so they can never accidentally
// lock themselves out.
const router = new Router();

router.use("/users", requireAdmin);

// Mirror of ALWAYS_ADMIN_EMAILS in requireAuth — emails that are permanent
// admins regardless of the DB. Surfaced as locked rows so the UI can show them
// without offering edit/remove actions.
const PERMANENT_ADMIN_EMAILS = new Set<string>([
  "chris.swinton@swintonaccountants.co.uk",
]);

type SerializedUser = {
  id: number;
  email: string;
  role: string;
  locked: boolean;
  isSelf: boolean;
  createdAt: string;
};

function serialize(
  row: typeof appUsersTable.$inferSelect,
  currentEmail: string | null,
): SerializedUser {
  const email = row.email.toLowerCase();
  return {
    id: row.id,
    email: row.email,
    role: row.role || "user",
    locked: PERMANENT_ADMIN_EMAILS.has(email),
    isSelf: currentEmail != null && email === currentEmail,
    createdAt: row.createdAt.toISOString(),
  };
}

// Resolve the signed-in user's primary email (lowercased). requireAdmin scopes
// req.userId to the shared tenant, so we re-derive the REAL email here for the
// self-lock guards.
async function currentUserEmail(
  req: Parameters<typeof getSessionUserId>[0],
): Promise<string | null> {
  const sessionUserId = getSessionUserId(req);
  if (!sessionUserId) return null;
  const email = await getUserEmail(sessionUserId);
  return email ? email.toLowerCase() : null;
}

router.get("/users", async (req, res): Promise<void> => {
  const currentEmail = await currentUserEmail(req);
  const rows = await db.select().from(appUsersTable);
  const serialized = rows.map((row) => serialize(row, currentEmail));

  // Synthesise locked rows for any permanent-admin operator emails that are not
  // already in the table, so the UI always shows them as admins.
  const present = new Set(serialized.map((u) => u.email.toLowerCase()));
  for (const email of PERMANENT_ADMIN_EMAILS) {
    if (!present.has(email)) {
      serialized.push({
        id: -1,
        email,
        role: "admin",
        locked: true,
        isSelf: currentEmail === email,
        createdAt: new Date(0).toISOString(),
      });
    }
  }

  // Admins first, then alphabetical by email.
  serialized.sort((a, b) => {
    if (a.role !== b.role) return a.role === "admin" ? -1 : 1;
    return a.email.localeCompare(b.email);
  });
  res.json(serialized);
});

router.post("/users", async (req, res): Promise<void> => {
  const parsed = CreateAppUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  const role = parsed.data.role;
  if (!(await roleExists(role))) {
    res.status(400).json({ error: "That role doesn't exist. Refresh and try again." });
    return;
  }

  if (PERMANENT_ADMIN_EMAILS.has(email)) {
    res.status(400).json({ error: "This email is already a permanent admin." });
    return;
  }

  const [existing] = await db
    .select()
    .from(appUsersTable)
    .where(eq(appUsersTable.email, email));
  if (existing) {
    res.status(400).json({ error: "That email already has access." });
    return;
  }

  const [row] = await db
    .insert(appUsersTable)
    .values({ email, role })
    .returning();
  bustUserCache();
  const currentEmail = await currentUserEmail(req);
  res.status(201).json(serialize(row, currentEmail));

  // Best-effort: notify the newly invited person. Single-dealer mode means
  // there is a single dealer settings row, so we use it for branding. Any
  // failure is logged inside sendInviteEmail and never affects the response.
  void (async () => {
    try {
      const [settings] = await db
        .select({ businessName: dealerSettingsTable.businessName })
        .from(dealerSettingsTable)
        .limit(1);
      await sendInviteEmail({
        to: email,
        businessName: settings?.businessName ?? "",
        role: role === "admin" ? "admin" : "user",
      });
    } catch (err) {
      logger.error({ err }, "Failed to dispatch staff invitation email");
    }
  })();
});

router.patch("/users/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const parsed = UpdateAppUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const role = parsed.data.role;
  if (!(await roleExists(role))) {
    res.status(400).json({ error: "That role doesn't exist. Refresh and try again." });
    return;
  }

  const [target] = await db
    .select()
    .from(appUsersTable)
    .where(eq(appUsersTable.id, id));
  if (!target) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const targetEmail = target.email.toLowerCase();
  if (PERMANENT_ADMIN_EMAILS.has(targetEmail)) {
    res.status(400).json({ error: "This user is a permanent admin." });
    return;
  }
  const currentEmail = await currentUserEmail(req);
  if (currentEmail && targetEmail === currentEmail) {
    res.status(400).json({ error: "You cannot change your own role." });
    return;
  }

  const [row] = await db
    .update(appUsersTable)
    .set({ role })
    .where(eq(appUsersTable.id, id))
    .returning();
  bustUserCache();
  res.json(serialize(row, currentEmail));
});

router.delete("/users/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [target] = await db
    .select()
    .from(appUsersTable)
    .where(eq(appUsersTable.id, id));
  if (!target) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const targetEmail = target.email.toLowerCase();
  if (PERMANENT_ADMIN_EMAILS.has(targetEmail)) {
    res.status(400).json({ error: "This user is a permanent admin." });
    return;
  }
  const currentEmail = await currentUserEmail(req);
  if (currentEmail && targetEmail === currentEmail) {
    res.status(400).json({ error: "You cannot remove your own access." });
    return;
  }

  await db.delete(appUsersTable).where(eq(appUsersTable.id, id));
  bustUserCache();
  res.status(204).end();
});

export default router;
