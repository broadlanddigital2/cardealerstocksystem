import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, dealerSettingsTable } from "@workspace/db";
import { UpdateSettingsBody } from "@workspace/api-zod";
import { requireAuth, requireAdmin } from "../middlewares/requireAuth";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

const DEFAULT_WORDING =
  "Margin Scheme – Second-hand Goods. No VAT is separately charged or reclaimable on this invoice.";

router.use("/settings", requireAuth);

function serialize(row: typeof dealerSettingsTable.$inferSelect) {
  return {
    id: row.id,
    businessName: row.businessName,
    address: row.address,
    vatNumber: row.vatNumber,
    businessType: row.businessType,
    companyName: row.companyName,
    companyNumber: row.companyNumber,
    placeOfRegistration: row.placeOfRegistration,
    registeredOfficeAddress: row.registeredOfficeAddress,
    phone: row.phone,
    email: row.email,
    website: row.website,
    bankAccountName: row.bankAccountName,
    bankName: row.bankName,
    bankSortCode: row.bankSortCode,
    bankAccountNumber: row.bankAccountNumber,
    logoPath: row.logoPath,
    marginSchemeWording: row.marginSchemeWording,
    defaultInvoiceWording: row.defaultInvoiceWording,
    invoiceAccentColour: row.invoiceAccentColour,
    vatQuarter: row.vatQuarter,
    vatRate: row.vatRate,
    carSalesCode: row.carSalesCode,
    vatQualifyingCode: row.vatQualifyingCode,
    otherSalesCode: row.otherSalesCode,
    carPurchasesCode: row.carPurchasesCode,
    stockCode: row.stockCode,
    auctionCostNoVatCode: row.auctionCostNoVatCode,
    auctionCostVatCode: row.auctionCostVatCode,
    cashOpeningBalance:
      row.cashOpeningBalance == null ? null : Number(row.cashOpeningBalance),
    financeProvided: row.financeProvided,
    financeFrnNumber: row.financeFrnNumber,
    financeWording: row.financeWording,
    showroomEnabled: row.showroomEnabled,
    showroomHeadline: row.showroomHeadline,
    showroomIntro: row.showroomIntro,
    showroomAboutTitle: row.showroomAboutTitle,
    showroomFeatures: row.showroomFeatures,
    showroomReviews: row.showroomReviews,
    showroomBgColour: row.showroomBgColour,
    showroomBgTextColour: row.showroomBgTextColour,
  };
}

async function getOrCreate(userId: string) {
  const [existing] = await db
    .select()
    .from(dealerSettingsTable)
    .where(eq(dealerSettingsTable.userId, userId));
  if (existing) return existing;
  const [created] = await db
    .insert(dealerSettingsTable)
    .values({ userId, businessName: "", marginSchemeWording: DEFAULT_WORDING })
    .returning();
  return created;
}

router.get("/settings", async (req, res): Promise<void> => {
  const row = await getOrCreate(req.userId!);
  res.json(serialize(row));
});

router.put("/settings", requireAdmin, async (req, res): Promise<void> => {
  const userId = req.userId!;
  const parsed = UpdateSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await getOrCreate(userId);
  const d = parsed.data;
  const update: Record<string, unknown> = {};
  for (const key of [
    "businessName",
    "address",
    "vatNumber",
    "businessType",
    "companyName",
    "companyNumber",
    "placeOfRegistration",
    "registeredOfficeAddress",
    "phone",
    "email",
    "website",
    "bankAccountName",
    "bankName",
    "bankSortCode",
    "bankAccountNumber",
    "logoPath",
    "marginSchemeWording",
    "defaultInvoiceWording",
    "invoiceAccentColour",
    "vatQuarter",
    "vatRate",
    "carSalesCode",
    "vatQualifyingCode",
    "otherSalesCode",
    "carPurchasesCode",
    "stockCode",
    "auctionCostNoVatCode",
    "auctionCostVatCode",
    "financeProvided",
    "financeFrnNumber",
    "financeWording",
    "showroomEnabled",
    "showroomHeadline",
    "showroomIntro",
    "showroomAboutTitle",
    "showroomFeatures",
    "showroomReviews",
    "showroomBgColour",
    "showroomBgTextColour",
  ] as const) {
    if (key in d) update[key] = (d as Record<string, unknown>)[key];
  }

  // Sanitise customer reviews as a server-side backstop: trim text, clamp the
  // rating to a 1-5 integer, and drop any rows with no author and no text so
  // direct API callers cannot persist malformed or out-of-range reviews.
  if ("showroomReviews" in update) {
    const raw = update.showroomReviews;
    update.showroomReviews = Array.isArray(raw)
      ? raw
          .map((r) => {
            const rev = (r ?? {}) as Record<string, unknown>;
            const author = String(rev.author ?? "").trim();
            const text = String(rev.text ?? "").trim();
            const date = String(rev.date ?? "").trim();
            const ratingNum = Math.round(Number(rev.rating));
            const rating = Number.isFinite(ratingNum)
              ? Math.min(5, Math.max(1, ratingNum))
              : 5;
            return { author, rating, text, ...(date ? { date } : {}) };
          })
          .filter((r) => r.author && r.text)
      : null;
  }

  // A Limited Company must carry its statutory company details (company name,
  // number, place of registration and registered office address) since they
  // appear on customer-facing invoices. Enforce server-side using effective
  // (existing + incoming) values so the rule cannot be bypassed by clients.
  const eff = (k: string): unknown =>
    k in d
      ? (d as Record<string, unknown>)[k]
      : (existing as Record<string, unknown>)[k];
  if (eff("businessType") === "Limited Company") {
    const missing = [
      "companyName",
      "companyNumber",
      "placeOfRegistration",
      "registeredOfficeAddress",
    ].some((k) => {
      const v = eff(k);
      return v == null || String(v).trim() === "";
    });
    if (missing) {
      res.status(400).json({
        error:
          "Company name, company number, place of registration and registered office address are required for a Limited Company.",
      });
      return;
    }
  }

  // When finance is provided the dealer is acting as an FCA-regulated credit
  // broker, so the FRN number and finance wording are required (they appear on
  // the customer-facing showroom). Enforce server-side using effective values.
  if (eff("financeProvided") === true) {
    const missing = ["financeFrnNumber", "financeWording"].some((k) => {
      const v = eff(k);
      return v == null || String(v).trim() === "";
    });
    if (missing) {
      res.status(400).json({
        error:
          "An FRN number and finance wording are required when finance is provided.",
      });
      return;
    }
  }

  // cashOpeningBalance is a numeric column, so Drizzle expects a string value.
  if ("cashOpeningBalance" in d) {
    const v = d.cashOpeningBalance;
    if (v != null && !Number.isFinite(v)) {
      res.status(400).json({ error: "Opening balance must be a valid number." });
      return;
    }
    update.cashOpeningBalance = v == null ? null : String(v);
  }

  // Logos are printed on customer-facing invoices, so they are public-readable.
  // Setting an ACL policy also ensures the private objects route only serves
  // objects that have been explicitly finalised (no wide-open access).
  if (typeof update.logoPath === "string" && update.logoPath) {
    try {
      update.logoPath = await objectStorageService.trySetObjectEntityAclPolicy(
        update.logoPath as string,
        { owner: userId, visibility: "public" },
      );
    } catch (err) {
      req.log.error({ err }, "Failed to set logo ACL policy");
      res.status(400).json({ error: "Failed to finalise uploaded logo." });
      return;
    }
  }

  // Showroom feature icons appear on the public, customer-facing showroom, so
  // they must be public-readable too. Finalise the ACL of any uploaded icon and
  // normalise the stored path (mirrors the logo handling above).
  if (Array.isArray(update.showroomFeatures)) {
    try {
      update.showroomFeatures = await Promise.all(
        (update.showroomFeatures as Array<Record<string, unknown>>).map(
          async (feat) => {
            const iconPath = feat?.iconPath;
            if (typeof iconPath === "string" && iconPath) {
              const finalised =
                await objectStorageService.trySetObjectEntityAclPolicy(iconPath, {
                  owner: userId,
                  visibility: "public",
                });
              return { ...feat, iconPath: finalised };
            }
            return feat;
          },
        ),
      );
    } catch (err) {
      req.log.error({ err }, "Failed to set feature icon ACL policy");
      res.status(400).json({ error: "Failed to finalise uploaded icon." });
      return;
    }
  }

  const [row] = await db
    .update(dealerSettingsTable)
    .set(update)
    .where(eq(dealerSettingsTable.userId, userId))
    .returning();
  res.json(serialize(row));
});

export default router;
