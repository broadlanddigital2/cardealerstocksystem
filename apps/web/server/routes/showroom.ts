import { Router } from "../http";
import { and, eq, or, desc, isNull, gt } from "drizzle-orm";
import {
  db,
  vehiclesTable,
  dealerSettingsTable,
  enquiriesTable,
} from "@workspace/db";
import { SHARED_TENANT_ID } from "../middlewares/requireAuth";
import { serializeShowroomVehicle } from "../lib/vehicleSerializer";
import { sendEnquiryNotification } from "../lib/email";

// Public, customer-facing showroom. These routes are intentionally
// UNAUTHENTICATED (no requireAuth) and are always scoped to the single shared
// dealer tenant. They expose ONLY dealer-chosen marketing data — never
// accounting figures, seller/buyer details, or other PII. See
// serializeShowroomVehicle for the strict public field allowlist.
const router = new Router();

type DealerSettingsRow = typeof dealerSettingsTable.$inferSelect;

// Public dealer profile: the contact/branding details a dealer already prints
// on customer-facing invoices, plus the statutory business identifiers (company
// name/number, place of registration, registered office and VAT number) that
// must appear on a business website footer. No bank details, ledger codes, or
// opening balances.
function serializePublicDealer(row: DealerSettingsRow | undefined) {
  return {
    businessName: row?.businessName ?? "",
    address: row?.address ?? null,
    phone: row?.phone ?? null,
    email: row?.email ?? null,
    website: row?.website ?? null,
    logoPath: row?.logoPath ?? null,
    businessType: row?.businessType ?? null,
    companyName: row?.companyName ?? null,
    companyNumber: row?.companyNumber ?? null,
    placeOfRegistration: row?.placeOfRegistration ?? null,
    registeredOfficeAddress: row?.registeredOfficeAddress ?? null,
    vatNumber: row?.vatNumber ?? null,
    financeProvided: row?.financeProvided ?? false,
    financeFrnNumber: row?.financeFrnNumber ?? null,
    financeWording: row?.financeWording ?? null,
    accentColour: row?.invoiceAccentColour ?? null,
    showroomEnabled: row?.showroomEnabled ?? false,
    showroomHeadline: row?.showroomHeadline ?? null,
    showroomIntro: row?.showroomIntro ?? null,
    showroomAboutTitle: row?.showroomAboutTitle ?? null,
    showroomFeatures: row?.showroomFeatures ?? null,
    showroomReviews: row?.showroomReviews ?? null,
    backgroundColour: row?.showroomBgColour ?? null,
    backgroundTextColour: row?.showroomBgTextColour ?? null,
  };
}

async function getDealer(): Promise<DealerSettingsRow | undefined> {
  const [row] = await db
    .select()
    .from(dealerSettingsTable)
    .where(eq(dealerSettingsTable.userId, SHARED_TENANT_ID));
  return row;
}

// GET /showroom — dealer profile plus all published vehicles still shown on the
// showroom: in stock, or marked sold-on-website (showroomSold). (safe
// public fields only). When the showroom is disabled, returns the dealer with
// showroomEnabled=false and an empty vehicle list so the frontend can show an
// "unavailable" state.
router.get("/showroom", async (_req, res): Promise<void> => {
  const dealer = await getDealer();
  const publicDealer = serializePublicDealer(dealer);

  if (!publicDealer.showroomEnabled) {
    res.json({ dealer: publicDealer, vehicles: [] });
    return;
  }

  const rows = await db
    .select()
    .from(vehiclesTable)
    .where(
      and(
        eq(vehiclesTable.userId, SHARED_TENANT_ID),
        eq(vehiclesTable.published, true),
        or(
          eq(vehiclesTable.status, "in_stock"),
          eq(vehiclesTable.showroomSold, true),
        ),
        // Hide vehicles whose scheduled website-removal time has passed.
        or(
          isNull(vehiclesTable.showroomRemoveAt),
          gt(vehiclesTable.showroomRemoveAt, new Date()),
        ),
      ),
    )
    .orderBy(desc(vehiclesTable.createdAt));

  res.json({
    dealer: publicDealer,
    vehicles: rows.map(serializeShowroomVehicle),
  });
});

// GET /showroom/vehicles/:id — a single published vehicle still shown on the
// showroom (in stock, or marked sold-on-website). 404 for anything unpublished,
// fully removed from the showroom, or belonging to another tenant.
router.get("/showroom/vehicles/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid vehicle id" });
    return;
  }

  const dealer = await getDealer();
  const publicDealer = serializePublicDealer(dealer);
  if (!publicDealer.showroomEnabled) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }

  const [row] = await db
    .select()
    .from(vehiclesTable)
    .where(
      and(
        eq(vehiclesTable.id, id),
        eq(vehiclesTable.userId, SHARED_TENANT_ID),
        eq(vehiclesTable.published, true),
        or(
          eq(vehiclesTable.status, "in_stock"),
          eq(vehiclesTable.showroomSold, true),
        ),
        or(
          isNull(vehiclesTable.showroomRemoveAt),
          gt(vehiclesTable.showroomRemoveAt, new Date()),
        ),
      ),
    );
  if (!row) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }

  res.json({
    dealer: publicDealer,
    vehicle: serializeShowroomVehicle(row),
  });
});

// Very small in-memory rate limiter for anonymous enquiry submission so the
// public endpoint cannot be trivially used to flood the dealer's leads.
const ENQUIRY_WINDOW_MS = 10 * 60 * 1000;
const ENQUIRY_MAX_PER_WINDOW = 5;
const enquiryHits = new Map<string, Array<number>>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const hits = (enquiryHits.get(ip) ?? []).filter(
    (t) => now - t < ENQUIRY_WINDOW_MS,
  );
  if (hits.length >= ENQUIRY_MAX_PER_WINDOW) {
    enquiryHits.set(ip, hits);
    return true;
  }
  hits.push(now);
  enquiryHits.set(ip, hits);
  return false;
}

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

// Honeypot field name. The public form renders this as a hidden input that real
// users never see (and so leave empty); automated bots that fill every field in
// the DOM will populate it, letting us silently drop the submission.
const HONEYPOT_FIELD = "company";

// POST /showroom/enquiries — anonymous customer enquiry (lead). Requires a name,
// a message, and at least one contact method (email or phone). An optional
// vehicleId is only attached when it refers to a vehicle currently visible on
// the showroom (published AND either in stock or marked sold-on-website);
// otherwise it is recorded as a general enquiry.
router.post("/showroom/enquiries", async (req, res): Promise<void> => {
  const ip = req.ip ?? "unknown";
  if (rateLimited(ip)) {
    res
      .status(429)
      .json({ error: "Too many enquiries. Please try again later." });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;

  // Honeypot: if the hidden field is filled, treat the submission as spam.
  // Respond with the same 201 as a success so bots get no signal, but skip the
  // insert so the lead never reaches the dealer's inbox.
  const honeypot = body[HONEYPOT_FIELD];
  if (typeof honeypot === "string" && honeypot.trim() !== "") {
    req.log.info({ ip }, "Enquiry rejected by honeypot");
    res.status(201).json({ ok: true });
    return;
  }

  const name = cleanString(body.name, 200);
  const email = cleanString(body.email, 320);
  const phone = cleanString(body.phone, 50);
  const message = cleanString(body.message, 5000);

  if (!name) {
    res.status(400).json({ error: "Please provide your name." });
    return;
  }
  if (!message) {
    res.status(400).json({ error: "Please include a message." });
    return;
  }
  if (!email && !phone) {
    res
      .status(400)
      .json({ error: "Please provide an email address or phone number." });
    return;
  }

  let vehicleId: number | null = null;
  let vehicleForEmail: {
    make: string | null;
    model: string | null;
    registrationNumber: string | null;
  } | null = null;
  if (body.vehicleId != null) {
    const candidate = Number(body.vehicleId);
    if (Number.isInteger(candidate) && candidate > 0) {
      const [vehicle] = await db
        .select({
          id: vehiclesTable.id,
          make: vehiclesTable.make,
          model: vehiclesTable.model,
          registrationNumber: vehiclesTable.registrationNumber,
        })
        .from(vehiclesTable)
        .where(
          and(
            eq(vehiclesTable.id, candidate),
            eq(vehiclesTable.userId, SHARED_TENANT_ID),
            eq(vehiclesTable.published, true),
            or(
              eq(vehiclesTable.status, "in_stock"),
              eq(vehiclesTable.showroomSold, true),
            ),
            or(
              isNull(vehiclesTable.showroomRemoveAt),
              gt(vehiclesTable.showroomRemoveAt, new Date()),
            ),
          ),
        );
      if (vehicle) {
        vehicleId = vehicle.id;
        vehicleForEmail = {
          make: vehicle.make,
          model: vehicle.model,
          registrationNumber: vehicle.registrationNumber,
        };
      }
    }
  }

  await db.insert(enquiriesTable).values({
    userId: SHARED_TENANT_ID,
    vehicleId,
    name,
    email,
    phone,
    message,
    status: "new",
  });

  // Respond to the customer immediately — the enquiry is already saved. Email
  // notification is fired best-effort afterwards and must never affect the
  // submission result.
  res.status(201).json({ ok: true });

  void notifyDealer({
    name,
    email,
    phone,
    message,
    vehicle: vehicleForEmail,
  }).catch((err: unknown) => {
    req.log.error({ err }, "Unexpected error notifying dealer of enquiry");
  });
});

// Loads the dealer's designated contact email and dispatches the enquiry
// notification. Runs after the response is sent; all failures are logged and
// swallowed so a customer's enquiry is never blocked by email problems.
async function notifyDealer(enquiry: {
  name: string;
  email: string | null;
  phone: string | null;
  message: string;
  vehicle: {
    make: string | null;
    model: string | null;
    registrationNumber: string | null;
  } | null;
}): Promise<void> {
  const dealer = await getDealer();
  const to = dealer?.email?.trim();
  if (!to) return;

  await sendEnquiryNotification({
    to,
    businessName: dealer?.businessName ?? "",
    customerName: enquiry.name,
    customerEmail: enquiry.email,
    customerPhone: enquiry.phone,
    message: enquiry.message,
    vehicle: enquiry.vehicle,
  });
}

export default router;
