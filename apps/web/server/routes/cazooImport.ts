import { Router } from "../http";
import { and, eq, ne, like, equalsIgnoreCase, pgError } from "@workspace/db";
import { z } from "zod/v4";
import { db, vehiclesTable, dealerSettingsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { serializeVehicle } from "../lib/vehicleSerializer";
import { ObjectStorageService, MAX_UPLOAD_BYTES } from "../lib/objectStorage";
import {
  CazooFetchError,
  classifyCazooUrl,
  fetchCazooHtml,
  fetchDealerStock,
  parseListingPage,
  type CazooPreviewVehicle,
} from "../lib/cazoo";
import { getCazooHealth, runCazooHealthCheck } from "../lib/cazooHealth";

const router = new Router();

// All signed-in invited users (admin AND user) may run Cazoo imports — the
// user asked for both access levels to have it (02/07/2026).
router.use("/cazoo", requireAuth);

const objectStorageService = new ObjectStorageService();

// Cap the number of photos copied per vehicle. Cazoo listings can carry 60+
// shots; the first N in order are the dealer's chosen gallery order.
const MAX_PHOTOS_PER_VEHICLE = 15;

const PreviewBody = z.object({
  url: z.string().min(1).max(500),
});

const ImportVehicleRow = z.object({
  listingId: z.string().regex(/^\d{1,12}$/),
  url: z.string().max(500),
  make: z.string().min(1).max(80),
  model: z.string().min(1).max(80),
  year: z.number().int().min(1900).max(2100).nullable().optional(),
  derivative: z.string().max(200).nullable().optional(),
  title: z.string().max(300).optional(),
  price: z.number().min(0).max(10_000_000).nullable().optional(),
  mileage: z.number().int().min(0).max(2_000_000).nullable().optional(),
  fuel: z.string().max(40).nullable().optional(),
  gearbox: z.string().max(40).nullable().optional(),
  colour: z.string().max(60).nullable().optional(),
  vrm: z.string().max(10).nullable().optional(),
  marketingDescription: z.string().max(10_000).nullable().optional(),
  photoPrefix: z
    .string()
    .regex(
      /^https:\/\/cdn\.images\.autoexposure\.co\.uk\/[A-Za-z0-9]+\/[A-Za-z0-9]+$/,
    )
    .nullable()
    .optional(),
  photoCount: z.number().int().min(0).max(200).optional(),
});

const ImportBody = z.object({
  vehicle: ImportVehicleRow,
});

interface DuplicateInfo {
  duplicate: boolean;
  duplicateReason: string | null;
}

/**
 * Flags likely duplicates against the current in-stock book:
 *  - a vehicle previously imported from the same Cazoo listing (strong match —
 *    the import stamps the listing URL into purchaseNotes);
 *  - a registration match when the listing exposes the VRM;
 *  - the same make+model in stock with mileage within 1,500 miles (weak match).
 */
async function findDuplicates(
  userId: string,
  rows: Array<CazooPreviewVehicle>,
): Promise<Map<string, DuplicateInfo>> {
  const inStock = await db
    .select({
      registrationNumber: vehiclesTable.registrationNumber,
      make: vehiclesTable.make,
      model: vehiclesTable.model,
      mileageAtPurchase: vehiclesTable.mileageAtPurchase,
      purchaseNotes: vehiclesTable.purchaseNotes,
      stockNumber: vehiclesTable.stockNumber,
    })
    .from(vehiclesTable)
    .where(
      and(eq(vehiclesTable.userId, userId), ne(vehiclesTable.status, "sold")),
    );

  const out = new Map<string, DuplicateInfo>();
  for (const row of rows) {
    let info: DuplicateInfo = { duplicate: false, duplicateReason: null };
    for (const v of inStock) {
      if (v.purchaseNotes?.includes(`/cars-for-sale/${row.listingId}/`)) {
        info = {
          duplicate: true,
          duplicateReason: `Already imported from this Cazoo listing (stock no. ${v.stockNumber})`,
        };
        break;
      }
      if (
        row.vrm &&
        v.registrationNumber.replace(/\s/g, "").toLowerCase() ===
          row.vrm.replace(/\s/g, "").toLowerCase()
      ) {
        info = {
          duplicate: true,
          duplicateReason: `Registration ${row.vrm} is already in stock (stock no. ${v.stockNumber})`,
        };
        break;
      }
      if (
        v.make.toLowerCase() === row.make.toLowerCase() &&
        v.model.toLowerCase() === row.model.toLowerCase() &&
        row.mileage != null &&
        v.mileageAtPurchase != null &&
        Math.abs(v.mileageAtPurchase - row.mileage) <= 1500
      ) {
        info = {
          duplicate: true,
          duplicateReason: `Possible match: ${v.make} ${v.model} with similar mileage already in stock (stock no. ${v.stockNumber})`,
        };
        break;
      }
    }
    out.set(row.listingId, info);
  }
  return out;
}

router.post("/cazoo/preview", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const parsed = PreviewBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Please paste a Cazoo page link." });
    return;
  }

  try {
    const { kind, url } = classifyCazooUrl(parsed.data.url);
    let vehicles: Array<CazooPreviewVehicle>;
    if (kind === "dealer") {
      vehicles = await fetchDealerStock(url);
    } else {
      const html = await fetchCazooHtml(url);
      const row = parseListingPage(html, url);
      vehicles = row ? [row] : [];
    }

    if (vehicles.length === 0) {
      res.status(422).json({
        error:
          kind === "dealer"
            ? "No cars were found on that dealer page. Check the link is your Cazoo dealer page and that you have cars listed."
            : "Couldn't read the car's details from that listing page. Check the link and try again.",
      });
      return;
    }

    // Remember the dealer's own Cazoo page so the daily health check knows
    // which live page to re-parse. Best-effort — never blocks the preview.
    if (kind === "dealer") {
      db.update(dealerSettingsTable)
        .set({ cazooDealerUrl: url })
        .where(eq(dealerSettingsTable.userId, userId))
        .then(
          () => {},
          (err: unknown) => {
            req.log.warn({ err }, "failed to remember cazoo dealer url");
          },
        );
    }

    const dupes = await findDuplicates(userId, vehicles);
    res.json({
      sourceType: kind,
      vehicles: vehicles.map((v) => ({
        ...v,
        ...(dupes.get(v.listingId) ?? {
          duplicate: false,
          duplicateReason: null,
        }),
      })),
    });
  } catch (err) {
    if (err instanceof CazooFetchError) {
      req.log.warn({ err: err.message }, "cazoo preview fetch failed");
      res.status(422).json({ error: err.friendly });
      return;
    }
    throw err;
  }
});

/**
 * Downloads up to MAX_PHOTOS_PER_VEHICLE photos from the AutoExposure CDN and
 * copies them into object storage as public-read objects (they appear on the
 * customer-facing showroom, same ACL as manually uploaded showroom photos).
 * Missing/broken photos are skipped — a partial gallery is fine.
 */
async function copyPhotos(
  userId: string,
  photoPrefix: string,
  photoCount: number,
  log: { warn: (obj: unknown, msg: string) => void },
): Promise<Array<string>> {
  const out: Array<string> = [];
  const total = Math.min(photoCount || 0, MAX_PHOTOS_PER_VEHICLE);
  for (let i = 1; i <= total; i++) {
    const photoUrl = `${photoPrefix}_${i}.jpg`;
    try {
      const resp = await fetch(photoUrl, {
        signal: AbortSignal.timeout(20_000),
      });
      if (!resp.ok || !resp.body) continue;
      const contentType = resp.headers.get("content-type") ?? "";
      if (!contentType.startsWith("image/")) continue;

      const objectId = crypto.randomUUID();
      const bytes = await resp.arrayBuffer();
      await objectStorageService.uploadObject(
        objectId,
        contentType,
        bytes,
        MAX_UPLOAD_BYTES,
      );
      const normalized = await objectStorageService.trySetObjectEntityAclPolicy(
        `/objects/uploads/${objectId}`,
        { owner: userId, visibility: "public" },
      );
      out.push(normalized);
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : String(err), photoUrl },
        "cazoo photo copy failed; skipping",
      );
    }
  }
  return out;
}

async function nextStockNumber(userId: string): Promise<string> {
  const rows = await db
    .select({ stockNumber: vehiclesTable.stockNumber })
    .from(vehiclesTable)
    .where(eq(vehiclesTable.userId, userId));
  let max = 0;
  for (const r of rows) {
    const match = String(r.stockNumber).match(/(\d+)$/);
    const n = match ? parseInt(match[1], 10) : NaN;
    if (!Number.isNaN(n) && n > max) max = n;
  }
  const sequence = String(max + 1).padStart(5, "0");
  const [settings] = await db
    .select({ businessName: dealerSettingsTable.businessName })
    .from(dealerSettingsTable)
    .where(eq(dealerSettingsTable.userId, userId));
  const initials = (settings?.businessName ?? "")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return initials + sequence;
}

async function nextPurchaseNumber(userId: string): Promise<string> {
  const rows = await db
    .select({ purchaseNumber: vehiclesTable.purchaseNumber })
    .from(vehiclesTable)
    .where(eq(vehiclesTable.userId, userId));
  let max = 0;
  for (const r of rows) {
    const match = String(r.purchaseNumber ?? "").match(/^PUR(\d+)$/);
    const n = match ? parseInt(match[1], 10) : NaN;
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return "PUR" + String(max + 1).padStart(5, "0");
}

function todayLondon(): string {
  // en-CA gives YYYY-MM-DD which matches the stored purchase_date format.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
  }).format(new Date());
}

// Last result of the scheduled Cazoo health check (site-redesign canary).
// Surfaced as a warning banner on the Import page.
router.get("/cazoo/health", async (_req, res): Promise<void> => {
  const result = await getCazooHealth();
  if (!result) {
    res.json({
      status: "pending",
      checkedAt: null,
      url: null,
      vehicleCount: 0,
      problems: [],
      message: "The Cazoo health check hasn't run yet.",
    });
    return;
  }
  res.json(result);
});

// Runs the health check right now (on-demand, e.g. a "Check now" button).
router.post("/cazoo/health/check", async (_req, res): Promise<void> => {
  const result = await runCazooHealthCheck();
  res.json(result);
});

// Imports ONE previewed vehicle per request. The frontend loops over the
// ticked rows so each import (with its photo copying) stays well within
// request timeouts and the user gets per-car progress.
router.post("/cazoo/import", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const parsed = ImportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const v = parsed.data.vehicle;

  // Skip if this exact listing was already imported (protects against
  // double-clicks and re-running the same preview).
  const [existing] = await db
    .select({ id: vehiclesTable.id, stockNumber: vehiclesTable.stockNumber })
    .from(vehiclesTable)
    .where(
      and(
        eq(vehiclesTable.userId, userId),
        ne(vehiclesTable.status, "sold"),
        like(vehiclesTable.purchaseNotes, `%/cars-for-sale/${v.listingId}/%`),
      ),
    )
    .limit(1);
  if (existing) {
    res.status(409).json({
      error: `This car was already imported (stock no. ${existing.stockNumber}).`,
    });
    return;
  }

  const registrationNumber = v.vrm?.trim()
    ? v.vrm.trim().toUpperCase()
    : `CAZOO-${v.listingId}`;

  // In-stock registration uniqueness (mirrors the create-vehicle rule).
  const [regDupe] = await db
    .select({ stockNumber: vehiclesTable.stockNumber })
    .from(vehiclesTable)
    .where(
      and(
        eq(vehiclesTable.userId, userId),
        equalsIgnoreCase(vehiclesTable.registrationNumber, registrationNumber),
        ne(vehiclesTable.status, "sold"),
      ),
    )
    .limit(1);
  if (regDupe) {
    res.status(409).json({
      error: `A vehicle with registration ${registrationNumber} is already in stock (stock no. ${regDupe.stockNumber}).`,
    });
    return;
  }

  const photoUrls = v.photoPrefix
    ? await copyPhotos(userId, v.photoPrefix, v.photoCount ?? 0, req.log)
    : [];

  const description = v.derivative ?? v.title ?? null;
  const purchaseNotes =
    `Imported from Cazoo listing ${v.url} on ${todayLondon()}. ` +
    `Please confirm the registration, purchase date, purchase price and seller.`;

  const insertValues = {
    userId,
    registrationNumber,
    make: v.make,
    model: v.model,
    colour: v.colour ?? null,
    description,
    mileageAtPurchase: v.mileage ?? null,
    // Deliberate placeholder date so imported cars are obvious in the
    // stock book until real purchase details are filled in.
    purchaseDate: "2000-01-01",
    purchaseType: "cazoo_import",
    purchaseInvoiceNumber: null,
    sellerName: "To be confirmed",
    purchasePrice: "0",
    vatQualifying: false,
    purchaseNotes,
    askingPrice: v.price != null ? String(v.price) : null,
    marketingDescription: v.marketingDescription ?? null,
    // Imported cars are NOT auto-published to the public showroom — staff
    // review each one and publish it manually (user request, 02/07/2026).
    published: false,
    photoUrls: photoUrls.length > 0 ? photoUrls : null,
    status: "in_stock",
  };

  let row: typeof vehiclesTable.$inferSelect | undefined;
  for (let attempt = 0; ; attempt++) {
    const stockNumber = await nextStockNumber(userId);
    const purchaseNumber = await nextPurchaseNumber(userId);
    try {
      [row] = await db
        .insert(vehiclesTable)
        .values({ stockNumber, purchaseNumber, ...insertValues })
        .returning();
      break;
    } catch (err) {
      const pgErr = pgError(err);
      const code = pgErr.code;
      if (code === "23505") {
        // Duplicate in-stock registration is a real conflict, not a race —
        // report it cleanly rather than retrying into a 500.
        if (pgErr.constraint === "vehicles_user_reg_in_stock_idx") {
          res.status(409).json({
            error: "duplicate_registration",
            message: `A vehicle with registration ${insertValues.registrationNumber} is already in stock, so this car was skipped.`,
          });
          return;
        }
        // Auto-allocated stock/purchase numbers can race; retry a few times.
        if (attempt < 3) continue;
      }
      throw err;
    }
  }

  res.status(201).json({
    vehicle: serializeVehicle(row!, false),
    photosImported: photoUrls.length,
  });
});

export default router;
