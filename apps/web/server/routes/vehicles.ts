import { Router } from "../http";
import { requireModule } from "../lib/modules";
import { and, eq, desc, ne, or, gte, lte, equalsIgnoreCase, containsIgnoreCase, pgError } from "@workspace/db";
import { db, vehiclesTable, invoicesTable, dealerSettingsTable, depositRefundsTable, type Condition } from "@workspace/db";
import {
  CreateVehicleBody,
  UpdateVehicleBody,
  RecordSaleBody,
  ImportVehiclesBody,
  GetVehicleParams,
  UpdateVehicleParams,
  DeleteVehicleParams,
  RecordSaleParams,
  RecordHoldingDepositBody,
  RecordHoldingDepositParams,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { serializeVehicle } from "../lib/vehicleSerializer";
import { ObjectStorageService } from "../lib/objectStorage";

const router = new Router();

router.use("/vehicles", requireAuth);

const objectStorageService = new ObjectStorageService();

// Showroom photos appear on the public, customer-facing website, so they must
// be stored public-read (same ACL approach as the dealer logo). This normalises
// each uploaded object path and marks it public; non-string/empty entries are
// dropped so a malformed client payload cannot poison the list.
async function finalizePhotoUrls(
  urls: Array<string>,
  userId: string,
): Promise<Array<string>> {
  const out: Array<string> = [];
  for (const u of urls) {
    if (typeof u === "string" && u.trim()) {
      const normalized = await objectStorageService.trySetObjectEntityAclPolicy(
        u,
        { owner: userId, visibility: "public" },
      );
      out.push(normalized);
    }
  }
  return out;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbExecutor = typeof db | Tx;

function businessInitials(name: string | null | undefined): string {
  return (name ?? "")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

async function nextStockNumber(
  userId: string,
  executor: DbExecutor = db,
): Promise<string> {
  const rows = await executor
    .select({ stockNumber: vehiclesTable.stockNumber })
    .from(vehiclesTable)
    .where(eq(vehiclesTable.userId, userId));
  let max = 0;
  for (const r of rows) {
    // Only the trailing digit group is the sequence; any letter/number prefix
    // (e.g. business initials) is ignored so sequencing stays correct.
    const match = String(r.stockNumber).match(/(\d+)$/);
    const n = match ? parseInt(match[1], 10) : NaN;
    if (!Number.isNaN(n) && n > max) max = n;
  }
  const sequence = String(max + 1).padStart(5, "0");

  const [settings] = await executor
    .select({ businessName: dealerSettingsTable.businessName })
    .from(dealerSettingsTable)
    .where(eq(dealerSettingsTable.userId, userId));

  return businessInitials(settings?.businessName) + sequence;
}

// Allocates the next per-user purchase number (PUR00001…). Each purchase gets a
// durable, unique number at creation; the Xero Bill export uses the dealer's
// Purchase Invoice Ref when present and falls back to this allocated number.
async function nextPurchaseNumber(
  userId: string,
  executor: DbExecutor = db,
): Promise<string> {
  const rows = await executor
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

interface PartExchangeContext {
  make?: string | null;
  model?: string | null;
  registration?: string | null;
  mileage?: number | null;
  pricePaid?: string | null;
  purchaseDate: string;
  buyerName?: string | null;
  buyerAddress?: string | null;
  soldRegistration: string;
  salesInvoiceNumber?: string | null;
}

/**
 * Creates (or updates) the stock-book record for a part-exchange vehicle taken
 * in against a sale. Returns the id of the linked part-exchange vehicle, or
 * null when no complete part-exchange details are supplied (i.e. unlinked).
 *
 * Idempotent: when the sold vehicle already links to a part-exchange record we
 * update it in place rather than creating a duplicate. When the details are
 * cleared the existing record is left intact (the dealer manages it) but the
 * sold vehicle is unlinked.
 */
async function syncPartExchangeVehicle(
  tx: Tx,
  userId: string,
  existingPxVehicleId: number | null,
  ctx: PartExchangeContext,
): Promise<number | null> {
  const make = ctx.make?.trim();
  const model = ctx.model?.trim();
  const registration = ctx.registration?.trim();

  // Without all three identifying details there is no part-exchange vehicle.
  if (!make || !model || !registration) {
    return null;
  }

  const values = {
    registrationNumber: registration,
    make,
    model,
    mileageAtPurchase: ctx.mileage ?? null,
    purchaseType: "part_exchange",
    purchaseDate: ctx.purchaseDate,
    purchasePrice: ctx.pricePaid ?? "0",
    sellerName: ctx.buyerName?.trim() || "Part exchange",
    sellerAddress: ctx.buyerAddress ?? null,
    purchaseNotes: `Part exchange taken against sale of ${ctx.soldRegistration}${
      ctx.salesInvoiceNumber ? ` (invoice ${ctx.salesInvoiceNumber})` : ""
    }`,
    status: "in_stock",
  };

  if (existingPxVehicleId != null) {
    await tx
      .update(vehiclesTable)
      .set(values)
      .where(
        and(
          eq(vehiclesTable.id, existingPxVehicleId),
          eq(vehiclesTable.userId, userId),
        ),
      );
    return existingPxVehicleId;
  }

  const stockNumber = await nextStockNumber(userId, tx);
  const purchaseNumber = await nextPurchaseNumber(userId, tx);
  const [created] = await tx
    .insert(vehiclesTable)
    .values({ userId, stockNumber, purchaseNumber, ...values })
    .returning({ id: vehiclesTable.id });
  return created.id;
}

function mapVehicleDuplicateError(
  err: unknown,
  res: import("../http").Response,
): boolean {
  const { code, constraint } = pgError(err);
  if (code !== "23505") return false;
  if (constraint === "invoices_user_invoice_number_idx") {
    res.status(400).json({ error: "Invoice number already exists. Choose another." });
  } else if (constraint === "vehicles_user_reg_in_stock_idx") {
    res.status(400).json({
      error:
        "The part-exchange vehicle registration is already in stock. Use a different registration.",
    });
  } else if (constraint === "vehicles_user_stock_number_idx") {
    res.status(400).json({ error: "Stock number already in use. Try again." });
  } else if (constraint === "vehicles_user_purchase_number_idx") {
    res.status(400).json({ error: "Purchase number already in use. Try again." });
  } else {
    res
      .status(400)
      .json({ error: "A duplicate value conflicts with an existing record." });
  }
  return true;
}

async function vehicleHasInvoice(
  userId: string,
  vehicleId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: invoicesTable.id })
    .from(invoicesTable)
    .where(
      and(
        eq(invoicesTable.userId, userId),
        eq(invoicesTable.vehicleId, vehicleId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

router.get("/vehicles", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const {
    status,
    dateFrom,
    dateTo,
    registrationNumber,
    stockNumber,
    makeModel,
    party,
  } = req.query as Record<string, string | undefined>;

  const conditions: Condition[] = [eq(vehiclesTable.userId, userId)];
  if (status) conditions.push(eq(vehiclesTable.status, status));
  if (dateFrom) conditions.push(gte(vehiclesTable.purchaseDate, dateFrom));
  if (dateTo) conditions.push(lte(vehiclesTable.purchaseDate, dateTo));
  if (registrationNumber)
    conditions.push(
      containsIgnoreCase(vehiclesTable.registrationNumber, registrationNumber),
    );
  if (stockNumber)
    conditions.push(
      containsIgnoreCase(vehiclesTable.stockNumber, stockNumber),
    );
  if (makeModel)
    conditions.push(
      or(
        containsIgnoreCase(vehiclesTable.make, makeModel),
        containsIgnoreCase(vehiclesTable.model, makeModel),
      ),
    );
  if (party)
    conditions.push(
      or(
        containsIgnoreCase(vehiclesTable.sellerName, party),
        containsIgnoreCase(vehiclesTable.buyerName, party),
      ),
    );

  const rows = await db
    .select()
    .from(vehiclesTable)
    .where(and(...conditions))
    .orderBy(desc(vehiclesTable.createdAt));

  const invoiced = await db
    .select({ vehicleId: invoicesTable.vehicleId })
    .from(invoicesTable)
    .where(eq(invoicesTable.userId, userId));
  const invoicedSet = new Set(invoiced.map((i) => i.vehicleId));

  res.json(rows.map((r) => serializeVehicle(r, invoicedSet.has(r.id))));
});

router.post("/vehicles", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const parsed = CreateVehicleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;

  // Prevent duplicate registration for unsold vehicles.
  const [dupe] = await db
    .select({ id: vehiclesTable.id })
    .from(vehiclesTable)
    .where(
      and(
        eq(vehiclesTable.userId, userId),
        equalsIgnoreCase(vehiclesTable.registrationNumber, data.registrationNumber),
        ne(vehiclesTable.status, "sold"),
      ),
    )
    .limit(1);
  if (dupe) {
    res.status(400).json({
      error: `A vehicle with registration ${data.registrationNumber} is already in stock.`,
    });
    return;
  }

  const finalizedPhotos = data.photoUrls
    ? await finalizePhotoUrls(data.photoUrls, userId)
    : null;

  let stockNumber = data.stockNumber?.trim();
  if (!stockNumber) {
    stockNumber = await nextStockNumber(userId);
  } else {
    const [snDupe] = await db
      .select({ id: vehiclesTable.id })
      .from(vehiclesTable)
      .where(
        and(
          eq(vehiclesTable.userId, userId),
          eq(vehiclesTable.stockNumber, stockNumber),
        ),
      )
      .limit(1);
    if (snDupe) {
      res.status(400).json({
        error: `Stock number ${stockNumber} is already in use.`,
      });
      return;
    }
  }

  const insertValues = {
    userId,
    stockNumber,
    registrationNumber: data.registrationNumber,
    make: data.make,
    model: data.model,
    vin: data.vin ?? null,
    colour: data.colour ?? null,
    description: data.description ?? null,
    mileageAtPurchase: data.mileageAtPurchase ?? null,
    purchaseDate: data.purchaseDate,
    purchaseInvoiceNumber: data.purchaseInvoiceNumber?.trim() || null,
    purchaseType: data.purchaseType,
    sellerName: data.sellerName,
    sellerAddress: data.sellerAddress ?? null,
    purchasePrice: String(data.purchasePrice),
    vatQualifying: data.vatQualifying ?? false,
    purchaseVat:
      data.vatQualifying && data.purchaseVat != null
        ? String(data.purchaseVat)
        : null,
    purchaseNotes: data.purchaseNotes ?? null,
    purchaseDocumentReference: data.purchaseDocumentReference ?? null,
    auctionCostNoVat:
      data.purchaseType === "auction" && data.auctionCostNoVat != null
        ? String(data.auctionCostNoVat)
        : null,
    auctionCostWithVat:
      data.purchaseType === "auction" && data.auctionCostWithVat != null
        ? String(data.auctionCostWithVat)
        : null,
    askingPrice: data.askingPrice != null ? String(data.askingPrice) : null,
    marketingDescription: data.marketingDescription ?? null,
    published: data.published ?? false,
    showroomSold: data.showroomSold ?? false,
    photoUrls: finalizedPhotos,
    status: "in_stock",
  };

  let row: typeof vehiclesTable.$inferSelect | undefined;
  for (let attempt = 0; ; attempt++) {
    const purchaseNumber = await nextPurchaseNumber(userId);
    try {
      [row] = await db
        .insert(vehiclesTable)
        .values({ purchaseNumber, ...insertValues })
        .returning();
      break;
    } catch (err) {
      const { code, constraint } = pgError(err);
      // Auto-allocated purchase numbers can race under concurrency; retry with
      // a freshly computed number a few times before surfacing the error.
      if (
        code === "23505" &&
        constraint === "vehicles_user_purchase_number_idx" &&
        attempt < 3
      ) {
        continue;
      }
      if (mapVehicleDuplicateError(err, res)) return;
      throw err;
    }
  }

  res.status(201).json(serializeVehicle(row!, false));
});

router.post("/vehicles/import", requireModule("csv_import"), async (req, res): Promise<void> => {
  const userId = req.userId!;
  const parsed = ImportVehiclesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const errors: string[] = [];
  let imported = 0;
  let skipped = 0;

  for (let i = 0; i < parsed.data.vehicles.length; i++) {
    const v = parsed.data.vehicles[i];
    try {
      // Prevent duplicate registration for in-stock vehicles.
      const [regDupe] = await db
        .select({ id: vehiclesTable.id })
        .from(vehiclesTable)
        .where(
          and(
            eq(vehiclesTable.userId, userId),
            equalsIgnoreCase(vehiclesTable.registrationNumber, v.registrationNumber),
            ne(vehiclesTable.status, "sold"),
          ),
        )
        .limit(1);
      if (regDupe) {
        skipped++;
        errors.push(
          `Row ${i + 1}: registration ${v.registrationNumber} is already in stock.`,
        );
        continue;
      }

      let stockNumber = v.stockNumber?.trim();
      if (stockNumber) {
        const [snDupe] = await db
          .select({ id: vehiclesTable.id })
          .from(vehiclesTable)
          .where(
            and(
              eq(vehiclesTable.userId, userId),
              eq(vehiclesTable.stockNumber, stockNumber),
            ),
          )
          .limit(1);
        if (snDupe) {
          skipped++;
          errors.push(`Row ${i + 1}: stock number ${stockNumber} already exists.`);
          continue;
        }
      } else {
        stockNumber = await nextStockNumber(userId);
      }

      const purchaseNumber = await nextPurchaseNumber(userId);

      await db.insert(vehiclesTable).values({
        userId,
        stockNumber,
        purchaseNumber,
        registrationNumber: v.registrationNumber,
        make: v.make,
        model: v.model,
        mileageAtPurchase: v.mileageAtPurchase ?? null,
        purchaseDate: v.purchaseDate,
        purchaseInvoiceNumber: v.purchaseInvoiceNumber ?? null,
        purchaseType: v.purchaseType,
        sellerName: v.sellerName,
        sellerAddress: v.sellerAddress ?? null,
        purchasePrice: String(v.purchasePrice),
        vatQualifying: v.vatQualifying ?? false,
        purchaseVat:
          v.vatQualifying && v.purchaseVat != null
            ? String(v.purchaseVat)
            : null,
        purchaseNotes: v.purchaseNotes ?? null,
        purchaseDocumentReference: v.purchaseDocumentReference ?? null,
        auctionCostNoVat:
          v.purchaseType === "auction" && v.auctionCostNoVat != null
            ? String(v.auctionCostNoVat)
            : null,
        auctionCostWithVat:
          v.purchaseType === "auction" && v.auctionCostWithVat != null
            ? String(v.auctionCostWithVat)
            : null,
        status: "in_stock",
      });
      imported++;
    } catch (err) {
      skipped++;
      errors.push(`Row ${i + 1}: ${(err as Error).message}`);
    }
  }

  res.json({ imported, skipped, errors });
});

router.get("/vehicles/:id", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const params = GetVehicleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select()
    .from(vehiclesTable)
    .where(
      and(eq(vehiclesTable.id, params.data.id), eq(vehiclesTable.userId, userId)),
    );
  if (!row) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }
  res.json(serializeVehicle(row, await vehicleHasInvoice(userId, row.id)));
});

router.patch("/vehicles/:id", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const params = UpdateVehicleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateVehicleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(vehiclesTable)
    .where(
      and(eq(vehiclesTable.id, params.data.id), eq(vehiclesTable.userId, userId)),
    );
  if (!existing) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }

  const d = parsed.data;

  // Effective values combine existing row with incoming changes.
  const effStatus = "status" in d && d.status ? d.status : existing.status;
  const effSaleDate =
    "saleDate" in d && d.saleDate !== undefined ? d.saleDate : existing.saleDate;
  const effPurchaseDate =
    "purchaseDate" in d && d.purchaseDate !== undefined
      ? d.purchaseDate
      : existing.purchaseDate;
  const effSalesInvoice =
    "salesInvoiceNumber" in d && d.salesInvoiceNumber !== undefined
      ? d.salesInvoiceNumber
      : existing.salesInvoiceNumber;
  const effBuyerName =
    "buyerName" in d && d.buyerName !== undefined ? d.buyerName : existing.buyerName;
  const effBuyerAddress =
    "buyerAddress" in d && d.buyerAddress !== undefined
      ? d.buyerAddress
      : existing.buyerAddress;
  const effSalePrice =
    "salePrice" in d && d.salePrice != null
      ? String(d.salePrice)
      : existing.salePrice;
  const effVatQualifying =
    "vatQualifying" in d && d.vatQualifying != null
      ? d.vatQualifying
      : existing.vatQualifying;
  const effSaleVat = effVatQualifying
    ? "saleVat" in d && d.saleVat != null
      ? String(d.saleVat)
      : existing.saleVat
    : null;

  // Rule: a vehicle cannot be marked sold without complete sale details.
  if (effStatus === "sold") {
    const missing: string[] = [];
    if (!effSaleDate) missing.push("sale date");
    if (!effSalesInvoice) missing.push("sales invoice number");
    if (!effBuyerName) missing.push("buyer name");
    if (!effBuyerAddress) missing.push("buyer address");
    if (!effSalePrice) missing.push("sale price");
    if (missing.length > 0) {
      res.status(400).json({
        error: `Cannot mark vehicle as sold without: ${missing.join(", ")}.`,
      });
      return;
    }
  }

  // Rule: sale date must be on or after purchase date (using effective values).
  if (effSaleDate && effPurchaseDate && effSaleDate < effPurchaseDate) {
    res.status(400).json({ error: "Sale date cannot be before purchase date." });
    return;
  }

  // Rule: prevent duplicate registration for in-stock vehicles when changing reg.
  const effRegistration =
    "registrationNumber" in d && d.registrationNumber
      ? d.registrationNumber
      : existing.registrationNumber;
  if (
    effStatus !== "sold" &&
    effRegistration.toLowerCase() !== existing.registrationNumber.toLowerCase()
  ) {
    const [regDupe] = await db
      .select({ id: vehiclesTable.id })
      .from(vehiclesTable)
      .where(
        and(
          eq(vehiclesTable.userId, userId),
          equalsIgnoreCase(vehiclesTable.registrationNumber, effRegistration),
          ne(vehiclesTable.status, "sold"),
          ne(vehiclesTable.id, params.data.id),
        ),
      )
      .limit(1);
    if (regDupe) {
      res.status(400).json({
        error: `A vehicle with registration ${effRegistration} is already in stock.`,
      });
      return;
    }
  }

  if (d.stockNumber && d.stockNumber !== existing.stockNumber) {
    const [snDupe] = await db
      .select({ id: vehiclesTable.id })
      .from(vehiclesTable)
      .where(
        and(
          eq(vehiclesTable.userId, userId),
          eq(vehiclesTable.stockNumber, d.stockNumber),
          ne(vehiclesTable.id, params.data.id),
        ),
      )
      .limit(1);
    if (snDupe) {
      res.status(400).json({ error: `Stock number ${d.stockNumber} is already in use.` });
      return;
    }
  }

  const update: Record<string, unknown> = {};
  const passthrough = [
    "stockNumber",
    "registrationNumber",
    "make",
    "model",
    "vin",
    "colour",
    "description",
    "mileageAtPurchase",
    "purchaseDate",
    "purchaseInvoiceNumber",
    "purchaseType",
    "sellerName",
    "sellerAddress",
    "purchaseNotes",
    "purchaseDocumentReference",
    "status",
    "saleDate",
    "salesInvoiceNumber",
    "buyerName",
    "buyerAddress",
    "buyerEmail",
    "buyerPhone",
    "mileageAtSale",
    "methodOfDisposal",
    "saleNotes",
    "invoiceNotes",
    "paymentMethod",
    "numberOfPayments",
  ] as const;
  for (const key of passthrough) {
    if (key in d) update[key] = (d as Record<string, unknown>)[key];
  }
  // A blank purchase invoice ref is stored as null so the durable auto-allocated
  // purchase number (PURxxxxx) is used in its place across reports and exports.
  if (typeof update.purchaseInvoiceNumber === "string") {
    const trimmed = update.purchaseInvoiceNumber.trim();
    update.purchaseInvoiceNumber = trimmed === "" ? null : trimmed;
  }
  if ("payments" in d) {
    update.payments = d.payments
      ? d.payments.map((p) => ({
          date: p.date ?? "",
          amount: p.amount ?? 0,
          paymentMethod: p.paymentMethod ?? null,
          type: p.type ?? null,
        }))
      : null;
  }
  if ("purchasePrice" in d && d.purchasePrice != null)
    update.purchasePrice = String(d.purchasePrice);
  if ("salePrice" in d && d.salePrice != null)
    update.salePrice = String(d.salePrice);
  // Rule: once a VAT-qualifying vehicle has a recorded sale it must remain
  // VAT-qualifying so that recorded sale stays VAT-qualifying. We key on the
  // presence of a recorded sale (saleDate) rather than the current status, so a
  // later status change (e.g. disposed/returned) cannot reopen the flag. While
  // the vehicle has no recorded sale, the flag can be unticked (e.g. to undo an
  // accidental selection).
  if (
    existing.saleDate != null &&
    existing.vatQualifying &&
    "vatQualifying" in d &&
    d.vatQualifying === false
  ) {
    res.status(400).json({
      error:
        "A VAT-qualifying vehicle that has been sold must remain VAT-qualifying — its sale must also be VAT-qualifying.",
    });
    return;
  }
  if ("vatQualifying" in d && d.vatQualifying != null)
    update.vatQualifying = d.vatQualifying;
  // Purchase/sale VAT only apply to VAT-qualifying vehicles. When the vehicle
  // is (or becomes) non-qualifying, clear any stored VAT amounts.
  if (effVatQualifying) {
    if ("purchaseVat" in d)
      update.purchaseVat =
        d.purchaseVat != null ? String(d.purchaseVat) : null;
    if ("saleVat" in d)
      update.saleVat = d.saleVat != null ? String(d.saleVat) : null;
  } else if ("vatQualifying" in d && d.vatQualifying === false) {
    update.purchaseVat = null;
    update.saleVat = null;
  }
  const effPurchaseType =
    "purchaseType" in d && d.purchaseType != null
      ? d.purchaseType
      : existing.purchaseType;
  if (effPurchaseType !== "auction") {
    update.auctionCostNoVat = null;
    update.auctionCostWithVat = null;
  } else {
    if ("auctionCostNoVat" in d)
      update.auctionCostNoVat =
        d.auctionCostNoVat != null ? String(d.auctionCostNoVat) : null;
    if ("auctionCostWithVat" in d)
      update.auctionCostWithVat =
        d.auctionCostWithVat != null ? String(d.auctionCostWithVat) : null;
  }
  if ("partExchangeAllowance" in d && d.partExchangeAllowance != null)
    update.partExchangeAllowance = String(d.partExchangeAllowance);
  for (const key of [
    "partExchangeMake",
    "partExchangeModel",
    "partExchangeRegistration",
    "partExchangeMileage",
  ] as const) {
    if (key in d) update[key] = (d as Record<string, unknown>)[key];
  }

  // Showroom (public website) fields.
  if ("marketingDescription" in d)
    update.marketingDescription = d.marketingDescription ?? null;
  if ("published" in d && d.published != null) update.published = d.published;
  if ("showroomSold" in d && d.showroomSold != null)
    update.showroomSold = d.showroomSold;
  if ("askingPrice" in d)
    update.askingPrice = d.askingPrice != null ? String(d.askingPrice) : null;
  if ("photoUrls" in d)
    update.photoUrls = d.photoUrls
      ? await finalizePhotoUrls(d.photoUrls, userId)
      : null;

  // Keep any linked invoice record in sync when sale details change.
  const saleFieldKeys = [
    "saleDate",
    "salesInvoiceNumber",
    "buyerName",
    "buyerAddress",
    "salePrice",
    "saleVat",
    "vatQualifying",
    "paymentMethod",
    "partExchangeAllowance",
    "partExchangeMake",
    "partExchangeModel",
    "partExchangeRegistration",
    "partExchangeMileage",
    "saleNotes",
    "invoiceNotes",
    "extras",
    "extrasOnFinanceInvoice",
    "financeCompanyName",
    "financeCompanyAddress",
    "financeCompanyEmail",
  ] as const;
  const saleFieldsTouched = saleFieldKeys.some((k) => k in d);

  // Effective part-exchange details combine existing row with incoming changes.
  const effPxMake =
    "partExchangeMake" in d ? d.partExchangeMake : existing.partExchangeMake;
  const effPxModel =
    "partExchangeModel" in d ? d.partExchangeModel : existing.partExchangeModel;
  const effPxRegistration =
    "partExchangeRegistration" in d
      ? d.partExchangeRegistration
      : existing.partExchangeRegistration;
  const effPxMileage =
    "partExchangeMileage" in d
      ? d.partExchangeMileage
      : existing.partExchangeMileage;
  const effPxAllowance =
    "partExchangeAllowance" in d && d.partExchangeAllowance != null
      ? String(d.partExchangeAllowance)
      : existing.partExchangeAllowance;

  // Rule: part-exchange make, model and registration are compulsory when a
  // part-exchange price is entered (only when sale details are being edited).
  if (
    saleFieldsTouched &&
    effPxAllowance != null &&
    Number(effPxAllowance) > 0
  ) {
    const missingPx: string[] = [];
    if (!effPxMake?.trim()) missingPx.push("make");
    if (!effPxModel?.trim()) missingPx.push("model");
    if (!effPxRegistration?.trim()) missingPx.push("registration");
    if (missingPx.length > 0) {
      res.status(400).json({
        error: `Part-exchange ${missingPx.join(", ")} ${missingPx.length === 1 ? "is" : "are"} required when a part-exchange price is entered.`,
      });
      return;
    }
  }

  let row;
  try {
    row = await db.transaction(async (tx) => {
      let [updated] = await tx
        .update(vehiclesTable)
        .set(update)
        .where(
          and(
            eq(vehiclesTable.id, params.data.id),
            eq(vehiclesTable.userId, userId),
          ),
        )
        .returning();

      // Create/sync the stock record for any part-exchange vehicle, but only
      // when sale details are being edited (not on unrelated vehicle edits).
      if (saleFieldsTouched) {
        const pxVehicleId = await syncPartExchangeVehicle(
          tx,
          userId,
          existing.partExchangeVehicleId,
          {
            make: effPxMake,
            model: effPxModel,
            registration: effPxRegistration,
            mileage: effPxMileage,
            pricePaid: effPxAllowance ?? null,
            purchaseDate: effSaleDate ?? effPurchaseDate,
            buyerName: effBuyerName,
            buyerAddress: effBuyerAddress,
            soldRegistration: effRegistration,
            salesInvoiceNumber: effSalesInvoice,
          },
        );
        if (pxVehicleId !== existing.partExchangeVehicleId) {
          [updated] = await tx
            .update(vehiclesTable)
            .set({ partExchangeVehicleId: pxVehicleId })
            .where(
              and(
                eq(vehiclesTable.id, params.data.id),
                eq(vehiclesTable.userId, userId),
              ),
            )
            .returning();
        }
      }

      if (saleFieldsTouched) {
        const effPaymentMethod =
          "paymentMethod" in d && d.paymentMethod !== undefined
            ? d.paymentMethod
            : existing.paymentMethod;
        const effPartExchange =
          "partExchangeAllowance" in d && d.partExchangeAllowance != null
            ? String(d.partExchangeAllowance)
            : existing.partExchangeAllowance;
        const effSaleNotes =
          "saleNotes" in d && d.saleNotes !== undefined
            ? d.saleNotes
            : existing.saleNotes;

        // Invoice extras live only on the invoice row. Use the incoming list
        // when the edit touches extras, otherwise keep the stored ones, so the
        // balance-payable recompute below never silently drops them.
        const [existingInvoice] = await tx
          .select({
            id: invoicesTable.id,
            extras: invoicesTable.extras,
            extrasOnFinanceInvoice: invoicesTable.extrasOnFinanceInvoice,
            financeCompanyName: invoicesTable.financeCompanyName,
            financeCompanyAddress: invoicesTable.financeCompanyAddress,
            financeCompanyEmail: invoicesTable.financeCompanyEmail,
          })
          .from(invoicesTable)
          .where(
            and(
              eq(invoicesTable.userId, userId),
              eq(invoicesTable.vehicleId, params.data.id),
            ),
          );

        // Finance company details live only on the invoice row. Use the
        // incoming value when the edit touches a finance field, otherwise keep
        // the stored one so an unrelated edit never wipes them.
        const effFinanceCompanyName =
          "financeCompanyName" in d
            ? (d.financeCompanyName ?? null)
            : (existingInvoice?.financeCompanyName ?? null);
        const effFinanceCompanyAddress =
          "financeCompanyAddress" in d
            ? (d.financeCompanyAddress ?? null)
            : (existingInvoice?.financeCompanyAddress ?? null);
        const effFinanceCompanyEmail =
          "financeCompanyEmail" in d
            ? (d.financeCompanyEmail ?? null)
            : (existingInvoice?.financeCompanyEmail ?? null);
        // Extras are normally billed on a separate VAT invoice, so the car sales
        // invoice balance payable covers the vehicle only (sale price plus any
        // sale VAT for VAT-qualifying vehicles, less part-exchange and any
        // holding deposit). When an extra is flagged on the finance invoice, its
        // gross is added so the recomputed balance stays consistent with the
        // serializer and the finance invoice PDF.
        // Per-item flags decide finance-invoice inclusion. Fall back to the
        // legacy invoice-level flag for stored extras that predate per-item flags
        // (and for partial payloads that omit the per-item flag) so an unrelated
        // edit never silently flips routing.
        const storedExtrasFlag =
          "extrasOnFinanceInvoice" in d && d.extrasOnFinanceInvoice !== undefined
            ? d.extrasOnFinanceInvoice
            : (existingInvoice?.extrasOnFinanceInvoice ?? false);
        const effExtras =
          "extras" in d
            ? d.extras && d.extras.length
              ? d.extras.map((e) => ({
                  description: e.description ?? "",
                  amount: e.amount ?? 0,
                  vat: e.vat ?? undefined,
                  onFinanceInvoice: e.onFinanceInvoice ?? storedExtrasFlag,
                }))
              : null
            : (existingInvoice?.extras ?? null);
        const effExtrasGross = (effExtras ?? [])
          .filter((e) => e.onFinanceInvoice ?? storedExtrasFlag)
          .reduce((sum, e) => sum + e.amount + (e.vat ?? 0), 0);
        // Keep the legacy invoice-level flag in sync (true when any extra is on
        // finance) so older read paths and fallbacks stay consistent.
        const effExtrasOnFinanceInvoice =
          (effExtras ?? []).some((e) => e.onFinanceInvoice ?? storedExtrasFlag);
        const computedBalance = String(
          Number(effSalePrice ?? 0) +
            Number(effSaleVat ?? 0) -
            Number(effPartExchange ?? 0) -
            Number(existing.holdingDepositAmount ?? 0) +
            effExtrasGross,
        );

        if (existingInvoice) {
          const invoiceUpdate: Record<string, unknown> = {
            paymentMethod: effPaymentMethod ?? null,
            partExchangeAllowance: effPartExchange ?? null,
            notes: effSaleNotes ?? null,
            financeCompanyName: effFinanceCompanyName,
            financeCompanyAddress: effFinanceCompanyAddress,
            financeCompanyEmail: effFinanceCompanyEmail,
          };
          if ("extras" in d) {
            invoiceUpdate.extras = effExtras;
            invoiceUpdate.extrasOnFinanceInvoice = effExtrasOnFinanceInvoice;
          } else if ("extrasOnFinanceInvoice" in d) {
            invoiceUpdate.extrasOnFinanceInvoice = effExtrasOnFinanceInvoice;
          }
          if (effSalesInvoice != null)
            invoiceUpdate.invoiceNumber = effSalesInvoice;
          if (effSaleDate != null) invoiceUpdate.invoiceDate = effSaleDate;
          if (effBuyerName != null) invoiceUpdate.customerName = effBuyerName;
          if (effBuyerAddress != null)
            invoiceUpdate.customerAddress = effBuyerAddress;
          if (effSalePrice != null) {
            invoiceUpdate.salePrice = String(effSalePrice);
            invoiceUpdate.balancePayable = computedBalance;
          }
          invoiceUpdate.saleVat = effSaleVat ?? null;

          await tx
            .update(invoicesTable)
            .set(invoiceUpdate)
            .where(
              and(
                eq(invoicesTable.userId, userId),
                eq(invoicesTable.vehicleId, params.data.id),
              ),
            );
        } else if (
          effStatus === "sold" &&
          effSalesInvoice != null &&
          effSaleDate != null &&
          effBuyerName != null &&
          effBuyerAddress != null &&
          effSalePrice != null
        ) {
          // No invoice row exists yet for this sold vehicle (e.g. the original
          // invoice creation failed). Create it now so sale edits — including
          // extras and recomputed totals — are actually persisted instead of
          // silently updating zero rows.
          await tx.insert(invoicesTable).values({
            userId,
            vehicleId: params.data.id,
            invoiceNumber: effSalesInvoice,
            invoiceDate: effSaleDate,
            customerName: effBuyerName,
            customerAddress: effBuyerAddress,
            salePrice: String(effSalePrice),
            saleVat: effSaleVat ?? null,
            paymentMethod: effPaymentMethod ?? null,
            partExchangeAllowance: effPartExchange ?? null,
            balancePayable: computedBalance,
            holdingDeposit:
              existing.holdingDepositAmount != null
                ? String(existing.holdingDepositAmount)
                : null,
            extras: effExtras,
            extrasOnFinanceInvoice: effExtrasOnFinanceInvoice,
            notes: effSaleNotes ?? null,
            financeCompanyName: effFinanceCompanyName,
            financeCompanyAddress: effFinanceCompanyAddress,
            financeCompanyEmail: effFinanceCompanyEmail,
          });
        }
      }

      return updated;
    });
  } catch (err) {
    if (mapVehicleDuplicateError(err, res)) return;
    throw err;
  }

  res.json(serializeVehicle(row, await vehicleHasInvoice(userId, row.id)));
});

router.delete("/vehicles/:id", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const params = DeleteVehicleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .delete(vehiclesTable)
    .where(
      and(eq(vehiclesTable.id, params.data.id), eq(vehiclesTable.userId, userId)),
    )
    .returning();
  if (!row) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }
  await db
    .delete(invoicesTable)
    .where(
      and(
        eq(invoicesTable.userId, userId),
        eq(invoicesTable.vehicleId, params.data.id),
      ),
    );
  res.sendStatus(204);
});

router.post("/vehicles/:id/sale", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const params = RecordSaleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = RecordSaleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const d = parsed.data;

  const [existing] = await db
    .select()
    .from(vehiclesTable)
    .where(
      and(eq(vehiclesTable.id, params.data.id), eq(vehiclesTable.userId, userId)),
    );
  if (!existing) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }

  // Rule: a sale can only be recorded for a vehicle that is in stock or
  // reserved (against a holding deposit) — never one already sold or disposed.
  if (existing.status !== "in_stock" && existing.status !== "reserved") {
    res.status(400).json({
      error: `Cannot record a sale for a vehicle that is ${existing.status.replace("_", " ")}.`,
    });
    return;
  }

  if (d.saleDate < existing.purchaseDate) {
    res.status(400).json({ error: "Sale date cannot be before purchase date." });
    return;
  }

  const partExchangeAllowance =
    d.partExchangeAllowance != null ? String(d.partExchangeAllowance) : null;

  // Rule: part-exchange make, model and registration are compulsory when a
  // part-exchange price is entered.
  if (partExchangeAllowance != null && Number(partExchangeAllowance) > 0) {
    const missingPx: string[] = [];
    if (!d.partExchangeMake?.trim()) missingPx.push("make");
    if (!d.partExchangeModel?.trim()) missingPx.push("model");
    if (!d.partExchangeRegistration?.trim()) missingPx.push("registration");
    if (missingPx.length > 0) {
      res.status(400).json({
        error: `Part-exchange ${missingPx.join(", ")} ${missingPx.length === 1 ? "is" : "are"} required when a part-exchange price is entered.`,
      });
      return;
    }
  }

  let row;
  try {
    row = await db.transaction(async (tx) => {
      // Create the stock record for any part-exchange vehicle taken in.
      const pxVehicleId = await syncPartExchangeVehicle(
        tx,
        userId,
        existing.partExchangeVehicleId,
        {
          make: d.partExchangeMake,
          model: d.partExchangeModel,
          registration: d.partExchangeRegistration,
          mileage: d.partExchangeMileage,
          pricePaid: partExchangeAllowance,
          purchaseDate: d.saleDate,
          buyerName: d.buyerName,
          buyerAddress: d.buyerAddress,
          soldRegistration: existing.registrationNumber,
          salesInvoiceNumber: d.salesInvoiceNumber,
        },
      );

      const [updated] = await tx
        .update(vehiclesTable)
        .set({
          status: "sold",
          saleDate: d.saleDate,
          salesInvoiceNumber: d.salesInvoiceNumber,
          buyerName: d.buyerName,
          buyerAddress: d.buyerAddress,
          buyerEmail: d.buyerEmail ?? null,
          buyerPhone: d.buyerPhone ?? null,
          salePrice: String(d.salePrice),
          saleVat:
            existing.vatQualifying && d.saleVat != null
              ? String(d.saleVat)
              : null,
          mileageAtSale: d.mileageAtSale ?? null,
          methodOfDisposal: d.methodOfDisposal ?? "retail_sale",
          saleNotes: d.saleNotes ?? null,
          invoiceNotes: d.invoiceNotes ?? null,
          paymentMethod: d.paymentMethod ?? null,
          numberOfPayments: d.numberOfPayments ?? null,
          payments: d.payments
            ? d.payments.map((p) => ({
                date: p.date ?? "",
                amount: p.amount ?? 0,
                paymentMethod: p.paymentMethod ?? null,
                type: p.type ?? null,
              }))
            : null,
          partExchangeAllowance,
          partExchangeMake: d.partExchangeMake ?? null,
          partExchangeModel: d.partExchangeModel ?? null,
          partExchangeRegistration: d.partExchangeRegistration ?? null,
          partExchangeMileage: d.partExchangeMileage ?? null,
          partExchangeVehicleId: pxVehicleId,
        })
        .where(
          and(
            eq(vehiclesTable.id, params.data.id),
            eq(vehiclesTable.userId, userId),
          ),
        )
        .returning();
      return updated;
    });
  } catch (err) {
    if (mapVehicleDuplicateError(err, res)) return;
    throw err;
  }

  res.json(serializeVehicle(row, await vehicleHasInvoice(userId, row.id)));
});

async function nextHoldingDepositReference(userId: string): Promise<string> {
  const rows = await db
    .select({ ref: vehiclesTable.holdingDepositReference })
    .from(vehiclesTable)
    .where(eq(vehiclesTable.userId, userId));
  let max = 0;
  for (const r of rows) {
    if (!r.ref) continue;
    const n = parseInt(String(r.ref).replace(/\D/g, ""), 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return `HD-${String(max + 1).padStart(4, "0")}`;
}

router.post(
  "/vehicles/:id/holding-deposit",
  async (req, res): Promise<void> => {
    const userId = req.userId!;
    const params = RecordHoldingDepositParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = RecordHoldingDepositBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const d = parsed.data;

    const [existing] = await db
      .select()
      .from(vehiclesTable)
      .where(
        and(
          eq(vehiclesTable.id, params.data.id),
          eq(vehiclesTable.userId, userId),
        ),
      );
    if (!existing) {
      res.status(404).json({ error: "Vehicle not found" });
      return;
    }
    if (existing.status !== "in_stock" && existing.status !== "reserved") {
      res.status(400).json({
        error: "Only an in-stock or reserved vehicle can take or edit a holding deposit.",
      });
      return;
    }

    // Editing an existing deposit keeps its reference; a new deposit gets the next one.
    const reference =
      existing.status === "reserved" && existing.holdingDepositReference
        ? existing.holdingDepositReference
        : await nextHoldingDepositReference(userId);

    const [updated] = await db
      .update(vehiclesTable)
      .set({
        status: "reserved",
        holdingDepositAmount: String(d.holdingDepositAmount),
        holdingDepositDate: d.holdingDepositDate,
        holdingDepositReference: reference,
        holdingDepositPaymentMethod: d.holdingDepositPaymentMethod ?? null,
        buyerName: d.buyerName,
        buyerAddress: d.buyerAddress,
      })
      .where(
        and(
          eq(vehiclesTable.id, params.data.id),
          eq(vehiclesTable.userId, userId),
        ),
      )
      .returning();

    res.json(serializeVehicle(updated, await vehicleHasInvoice(userId, updated.id)));
  },
);

router.post(
  "/vehicles/:id/refund-deposit",
  async (req, res): Promise<void> => {
    const userId = req.userId!;
    const params = RecordHoldingDepositParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [existing] = await db
      .select()
      .from(vehiclesTable)
      .where(
        and(
          eq(vehiclesTable.id, params.data.id),
          eq(vehiclesTable.userId, userId),
        ),
      );
    if (!existing) {
      res.status(404).json({ error: "Vehicle not found" });
      return;
    }
    if (existing.status !== "reserved") {
      res.status(400).json({
        error: "Only a reserved vehicle with a holding deposit can be refunded.",
      });
      return;
    }

    try {
      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(vehiclesTable)
          .set({
            status: "in_stock",
            holdingDepositAmount: null,
            holdingDepositDate: null,
            holdingDepositReference: null,
            holdingDepositPaymentMethod: null,
            buyerName: null,
            buyerAddress: null,
          })
          .where(
            and(
              eq(vehiclesTable.id, params.data.id),
              eq(vehiclesTable.userId, userId),
              eq(vehiclesTable.status, "reserved"),
            ),
          )
          .returning();

        if (!row) return null;

        await tx.insert(depositRefundsTable).values({
          userId,
          vehicleId: existing.id,
          stockNumber: existing.stockNumber,
          registrationNumber: existing.registrationNumber,
          make: existing.make,
          model: existing.model,
          depositAmount: existing.holdingDepositAmount ?? "0",
          depositDate: existing.holdingDepositDate,
          depositReference: existing.holdingDepositReference,
          buyerName: existing.buyerName,
          buyerAddress: existing.buyerAddress,
          refundDate: new Date().toISOString().split("T")[0],
        });

        return row;
      });

      if (!updated) {
        res.status(400).json({
          error: "Only a reserved vehicle with a holding deposit can be refunded.",
        });
        return;
      }

      res.json(serializeVehicle(updated, await vehicleHasInvoice(userId, updated.id)));
    } catch (err) {
      if (mapVehicleDuplicateError(err, res)) return;
      throw err;
    }
  },
);

// POST /vehicles/:id/showroom-removal — choose when a just-sold vehicle is
// removed from the public website. "now" hides it immediately; "in_7_days"
// keeps it visible with a SOLD banner and schedules automatic removal a week
// later; "manual" keeps it visible until the dealer removes it themselves.
const SHOWROOM_REMOVAL_MODES = ["now", "in_7_days", "manual"] as const;
type ShowroomRemovalMode = (typeof SHOWROOM_REMOVAL_MODES)[number];

router.post(
  "/vehicles/:id/showroom-removal",
  async (req, res): Promise<void> => {
    const userId = req.userId!;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid vehicle id" });
      return;
    }
    const mode = (req.body ?? {}).mode as unknown;
    if (!SHOWROOM_REMOVAL_MODES.includes(mode as ShowroomRemovalMode)) {
      res.status(400).json({ error: "Invalid removal mode." });
      return;
    }

    const [existing] = await db
      .select({ id: vehiclesTable.id })
      .from(vehiclesTable)
      .where(and(eq(vehiclesTable.id, id), eq(vehiclesTable.userId, userId)));
    if (!existing) {
      res.status(404).json({ error: "Vehicle not found" });
      return;
    }

    let showroomSold: boolean;
    let showroomRemoveAt: Date | null;
    if (mode === "now") {
      showroomSold = false;
      showroomRemoveAt = null;
    } else if (mode === "in_7_days") {
      showroomSold = true;
      showroomRemoveAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    } else {
      showroomSold = true;
      showroomRemoveAt = null;
    }

    const [updated] = await db
      .update(vehiclesTable)
      .set({ showroomSold, showroomRemoveAt })
      .where(and(eq(vehiclesTable.id, id), eq(vehiclesTable.userId, userId)))
      .returning();

    res.json(serializeVehicle(updated!, await vehicleHasInvoice(userId, updated!.id)));
  },
);

export default router;
