/**
 * Cazoo listing-page fetching and parsing for the "Import from Cazoo" feature.
 *
 * Cazoo (the marketplace now run by Motors.co.uk) has no official API, but its
 * public pages contain enough structured data to import a dealer's own stock:
 *  - dealer pages render one card per vehicle with a `data-gtm-ecommerce` JSON
 *    blob (make/model/price/photo count), badges (year/mileage/fuel/gearbox)
 *    and the AutoExposure CDN photo prefix;
 *  - an ld+json Product list supplies the full display name (incl. derivative);
 *  - single listing pages carry a `vehicleDetails` JSON blob plus an ld+json
 *    Product with the marketing description.
 *
 * cazoo.co.uk sits behind a Vercel bot-check that blocks plain server-side
 * fetches from datacenter IPs, so we try a direct fetch first and fall back to
 * the Firecrawl scraping API (FIRECRAWL_API_KEY) which renders the page for us.
 */

export class CazooFetchError extends Error {
  constructor(
    message: string,
    public readonly friendly: string,
  ) {
    super(message);
    this.name = "CazooFetchError";
  }
}

export interface CazooPreviewVehicle {
  listingId: string;
  url: string;
  make: string;
  model: string;
  year: number | null;
  derivative: string | null;
  title: string;
  price: number | null;
  mileage: number | null;
  fuel: string | null;
  gearbox: string | null;
  colour: string | null;
  vrm: string | null;
  marketingDescription: string | null;
  photoPrefix: string | null;
  photoCount: number;
  thumbnailUrl: string | null;
}

export type CazooUrlKind = "dealer" | "listing";

/**
 * Validates a pasted URL and classifies it. Throws CazooFetchError with a
 * friendly message when the URL is not a Cazoo dealer or listing page.
 */
export function classifyCazooUrl(raw: string): {
  kind: CazooUrlKind;
  url: string;
} {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new CazooFetchError(
      `Invalid URL: ${raw}`,
      "That doesn't look like a web address. Please paste the full Cazoo page link, starting with https://",
    );
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== "www.cazoo.co.uk" && host !== "cazoo.co.uk") {
    throw new CazooFetchError(
      `Not a cazoo.co.uk URL: ${host}`,
      "That link isn't a Cazoo page. Please paste a link from www.cazoo.co.uk — either your dealer page or one of your car listings.",
    );
  }
  const path = parsed.pathname;
  if (/^\/cars-for-sale\/\d+\/?$/.test(path)) {
    return { kind: "listing", url: `https://www.cazoo.co.uk${path.replace(/\/?$/, "/")}` };
  }
  if (/^\/dealers\/[a-z0-9-]+\/?$/i.test(path)) {
    return { kind: "dealer", url: `https://www.cazoo.co.uk${path.replace(/\/?$/, "/")}` };
  }
  throw new CazooFetchError(
    `Unsupported cazoo.co.uk path: ${path}`,
    "That Cazoo link isn't a dealer page or a car listing. Please paste your dealer page link (www.cazoo.co.uk/dealers/…) or a single car's link (www.cazoo.co.uk/cars-for-sale/…).",
  );
}

function looksLikeChallenge(html: string): boolean {
  return (
    html.includes("Vercel Security Checkpoint") ||
    html.includes("data-astro-cid-nbv56vs3")
  );
}

function looksLikeCazooContent(html: string): boolean {
  return (
    html.includes('data-testid="search-result"') ||
    html.includes("vehicleDetails") ||
    html.includes("application/ld+json")
  );
}

async function directFetch(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-GB,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    if (looksLikeChallenge(html) || !looksLikeCazooContent(html)) return null;
    return html;
  } catch {
    return null;
  }
}

async function firecrawlFetch(url: string): Promise<string> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new CazooFetchError(
      "FIRECRAWL_API_KEY not set and direct fetch blocked",
      "Cazoo is blocking automated reading of its pages from this server, and no page-reading service is configured. Ask your administrator to add a Firecrawl API key in the app settings (FIRECRAWL_API_KEY).",
    );
  }
  let res: Response;
  try {
    res = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ url, formats: ["rawHtml"] }),
      signal: AbortSignal.timeout(90_000),
    });
  } catch (err) {
    throw new CazooFetchError(
      `Firecrawl request failed: ${(err as Error).message}`,
      "The page-reading service didn't respond in time. Please try again in a minute.",
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new CazooFetchError(
      `Firecrawl returned ${res.status}: ${body.slice(0, 300)}`,
      res.status === 401 || res.status === 403
        ? "The page-reading service rejected the configured API key. Ask your administrator to check the FIRECRAWL_API_KEY setting."
        : res.status === 402
          ? "The page-reading service has run out of credits. Ask your administrator to top up the Firecrawl account."
          : "The Cazoo page couldn't be read right now. Please try again in a minute.",
    );
  }
  const json = (await res.json().catch(() => null)) as {
    success?: boolean;
    data?: { rawHtml?: string };
  } | null;
  const html = json?.data?.rawHtml;
  if (!json?.success || !html) {
    throw new CazooFetchError(
      "Firecrawl response missing rawHtml",
      "The Cazoo page couldn't be read right now. Please try again in a minute.",
    );
  }
  if (looksLikeChallenge(html) || !looksLikeCazooContent(html)) {
    throw new CazooFetchError(
      "Firecrawl returned a challenge/empty page",
      "Cazoo blocked the page read this time. Please try again in a minute.",
    );
  }
  return html;
}

/** Fetches a Cazoo page's HTML: direct first, Firecrawl fallback. */
export async function fetchCazooHtml(url: string): Promise<string> {
  const direct = await directFetch(url);
  if (direct) return direct;
  return firecrawlFetch(url);
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function parseNumber(s: string | null | undefined): number | null {
  if (!s) return null;
  const n = Number(String(s).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Extracts ld+json Product entries: maps listing id -> full display name. */
function extractProductNames(html: string): Map<string, string> {
  const map = new Map<string, string>();
  const blocks = html.match(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
  );
  if (!blocks) return map;
  for (const block of blocks) {
    const inner = block
      .replace(/^<script type="application\/ld\+json">/, "")
      .replace(/<\/script>$/, "");
    try {
      const data = JSON.parse(inner) as unknown;
      const products: Array<{ name?: string; url?: string }> = [];
      const collect = (node: unknown): void => {
        if (Array.isArray(node)) {
          node.forEach(collect);
          return;
        }
        if (node && typeof node === "object") {
          const obj = node as Record<string, unknown>;
          if (obj["@type"] === "Product") {
            products.push(obj as { name?: string; url?: string });
          }
          for (const v of Object.values(obj)) collect(v);
        }
      };
      collect(data);
      for (const p of products) {
        const idMatch = p.url?.match(/\/cars-for-sale\/(\d+)\//);
        if (idMatch && p.name) {
          map.set(idMatch[1], p.name.replace(/\s+/g, " ").trim());
        }
      }
    } catch {
      // Ignore malformed JSON blocks.
    }
  }
  return map;
}

/**
 * Derives the trim/derivative portion of a Cazoo display name by removing the
 * make, model and year tokens, e.g. "Hyundai Getz 2006 1.1 SE 3Door" -> "1.1 SE 3Door".
 */
function deriveDerivative(
  name: string | undefined,
  make: string,
  model: string,
  year: number | null,
): string | null {
  if (!name) return null;
  let s = name;
  const strip = (token: string): void => {
    if (!token) return;
    const idx = s.toLowerCase().indexOf(token.toLowerCase());
    if (idx >= 0) s = s.slice(0, idx) + s.slice(idx + token.length);
  };
  strip(make);
  strip(model);
  if (year) strip(String(year));
  const out = s.replace(/\s+/g, " ").trim();
  return out || null;
}

function buildTitle(
  make: string,
  model: string,
  year: number | null,
  derivative: string | null,
): string {
  return [year ? String(year) : null, make, model, derivative]
    .filter(Boolean)
    .join(" ");
}

/** Parses a dealer stock page into preview rows. */
export function parseDealerPage(html: string): Array<CazooPreviewVehicle> {
  const names = extractProductNames(html);
  const cards = html.split('<li data-testid="search-result"').slice(1);
  const seen = new Set<string>();
  const out: Array<CazooPreviewVehicle> = [];

  for (const card of cards) {
    const idMatch = card.match(/\/cars-for-sale\/(\d+)\//);
    if (!idMatch) continue;
    const listingId = idMatch[1];
    if (seen.has(listingId)) continue;
    seen.add(listingId);

    let make = "";
    let model = "";
    let price: number | null = null;
    let photoCount = 0;
    const gtmMatch = card.match(/data-gtm-ecommerce="([^"]*)"/);
    if (gtmMatch) {
      try {
        const gtm = JSON.parse(decodeHtmlEntities(gtmMatch[1])) as {
          items?: Array<{
            item_brand?: string;
            item_variant?: string;
            price?: number;
            image_count?: number;
          }>;
        };
        const item = gtm.items?.[0];
        make = item?.item_brand?.trim() ?? "";
        model = item?.item_variant?.trim() ?? "";
        price = typeof item?.price === "number" ? item.price : null;
        photoCount =
          typeof item?.image_count === "number" ? item.image_count : 0;
      } catch {
        // Fall through to name-based fields below.
      }
    }

    const badge = (kind: string): string | null => {
      const m = card.match(
        new RegExp(`data-testid="${kind}-badge"[^>]*>([^<]+)<`),
      );
      return m ? m[1].trim() : null;
    };
    const year = parseNumber(badge("year"));
    const mileage = parseNumber(badge("mileage"));
    const fuel = badge("fuel");
    const gearbox = badge("gearbox");

    const photoMatch = card.match(
      /cdn\.images\.autoexposure\.co\.uk\/([A-Za-z0-9]+)\/([A-Za-z0-9]+)_\d+[a-z]?\.jpg/,
    );
    const photoPrefix = photoMatch
      ? `https://cdn.images.autoexposure.co.uk/${photoMatch[1]}/${photoMatch[2]}`
      : null;

    const name = names.get(listingId);
    if (!make && name) {
      // Fall back: first token of the ld+json name is the make.
      const parts = name.split(" ");
      make = parts[0] ?? "";
      model = parts[1] ?? "";
    }
    if (!make) continue;

    const derivative = deriveDerivative(name, make, model, year ? Math.round(year) : null);
    out.push({
      listingId,
      url: `https://www.cazoo.co.uk/cars-for-sale/${listingId}/`,
      make,
      model,
      year: year ? Math.round(year) : null,
      derivative,
      title: buildTitle(make, model, year ? Math.round(year) : null, derivative),
      price,
      mileage: mileage ? Math.round(mileage) : null,
      fuel,
      gearbox,
      colour: null,
      vrm: null,
      marketingDescription: null,
      photoPrefix,
      photoCount,
      thumbnailUrl: photoPrefix ? `${photoPrefix}_1e.jpg` : null,
    });
  }
  return out;
}

/** Parses a single listing (vehicle detail) page into one preview row. */
export function parseListingPage(
  html: string,
  url: string,
): CazooPreviewVehicle | null {
  const idMatch = url.match(/\/cars-for-sale\/(\d+)\//);
  if (!idMatch) return null;
  const listingId = idMatch[1];

  // The Next.js flight data embeds an escaped vehicleDetails JSON blob.
  let details: Record<string, unknown> | null = null;
  const escMatch = html.match(/\\"vehicleDetails\\":\{([^}]*)\}/);
  if (escMatch) {
    try {
      details = JSON.parse(
        `{${escMatch[1].replace(/\\"/g, '"')}}`,
      ) as Record<string, unknown>;
    } catch {
      details = null;
    }
  }
  if (!details) {
    const plainMatch = html.match(/"vehicleDetails":\{([^}]*)\}/);
    if (plainMatch) {
      try {
        details = JSON.parse(`{${plainMatch[1]}}`) as Record<string, unknown>;
      } catch {
        details = null;
      }
    }
  }

  const str = (k: string): string | null => {
    const v = details?.[k];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  const num = (k: string): number | null => {
    const v = details?.[k];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };

  const make = str("vehicleMake");
  const model = str("vehicleModel");
  if (!make || !model) return null;
  const year = num("vehicleYear");
  const price = num("vehiclePrice");
  const colour = str("vehicleColour");
  const fuel = str("vehicleFuelType");
  const gearbox = str("vehicleTransmission");
  const photoCount = num("vehicleImageCount") ?? 0;

  // vehicleTitle is like "2006  1.1 SE 3Door" — strip the year for derivative.
  const rawTitle = str("vehicleTitle");
  let derivative: string | null = null;
  if (rawTitle) {
    derivative = rawTitle
      .replace(year ? String(year) : "", "")
      .replace(/\s+/g, " ")
      .trim() || null;
  }

  // Mileage comes from the rendered spec section, not the JSON blob.
  const mileageMatch = html.match(
    /Mileage<\/span><span[^>]*>([\d,]+)\s*miles/,
  );
  const mileage = mileageMatch ? parseNumber(mileageMatch[1]) : null;

  // Registration: Cazoo calls this "vrm" when present in the page data.
  const vrmMatch =
    html.match(/\\"vrm\\":\\"([A-Za-z0-9 ]{2,10})\\"/) ??
    html.match(/"vrm":"([A-Za-z0-9 ]{2,10})"/);
  const vrm = vrmMatch ? vrmMatch[1].toUpperCase().trim() : null;

  // Marketing description from the ld+json Product block.
  let marketingDescription: string | null = null;
  const ldBlocks = html.match(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
  );
  if (ldBlocks) {
    for (const block of ldBlocks) {
      try {
        const data = JSON.parse(
          block
            .replace(/^<script type="application\/ld\+json">/, "")
            .replace(/<\/script>$/, ""),
        ) as { "@type"?: string; description?: string };
        if (data["@type"] === "Product" && data.description) {
          marketingDescription = data.description.trim();
          break;
        }
      } catch {
        // Ignore malformed blocks.
      }
    }
  }

  // Photo prefix from og:image (e.g. .../AETA78915/AETV59044790_1.jpg).
  const ogMatch = html.match(
    /property="og:image" content="(https:\/\/cdn\.images\.autoexposure\.co\.uk\/[A-Za-z0-9]+\/[A-Za-z0-9]+)_\d+[a-z]?\.jpg"/,
  );
  const photoPrefix = ogMatch ? ogMatch[1] : null;

  return {
    listingId,
    url: `https://www.cazoo.co.uk/cars-for-sale/${listingId}/`,
    make,
    model,
    year,
    derivative,
    title: buildTitle(make, model, year, derivative),
    price,
    mileage: mileage ? Math.round(mileage) : null,
    fuel,
    gearbox,
    colour,
    vrm,
    marketingDescription,
    photoPrefix,
    photoCount,
    thumbnailUrl: photoPrefix ? `${photoPrefix}_1e.jpg` : null,
  };
}

// If more than this fraction of parsed rows are missing a key field, the field
// counts as broken. Individual listings legitimately lack the odd field (e.g.
// a brand-new listing without photos), so we only alarm on widespread absence.
const MISSING_FIELD_THRESHOLD = 0.5;

/**
 * Inspects parsed dealer-page rows for signs that Cazoo changed their markup:
 * zero rows at all, or a majority of rows missing title/price/mileage/photo
 * prefix. Returns a list of human-readable problems (empty = healthy). Used by
 * the daily Cazoo health check (lib/cazooHealth.ts).
 */
export function evaluateParsedStock(
  rows: Array<CazooPreviewVehicle>,
): Array<string> {
  if (rows.length === 0) {
    return [
      "No vehicles could be read from the dealer page at all (the parser returned zero rows).",
    ];
  }
  const problems: Array<string> = [];
  const check = (
    label: string,
    missing: (row: CazooPreviewVehicle) => boolean,
  ): void => {
    const count = rows.filter(missing).length;
    if (count / rows.length > MISSING_FIELD_THRESHOLD) {
      problems.push(
        `${count} of ${rows.length} vehicles are missing their ${label}.`,
      );
    }
  };
  check("title", (r) => !r.title || !r.title.trim());
  check("price", (r) => r.price == null);
  check("mileage", (r) => r.mileage == null);
  check("photos (photo prefix)", (r) => !r.photoPrefix);
  return problems;
}

/**
 * Fetches and parses a dealer's full stock, following ?page=N pagination until
 * a page yields no new listings (max 5 pages as a safety cap).
 */
export async function fetchDealerStock(
  dealerUrl: string,
): Promise<Array<CazooPreviewVehicle>> {
  const all: Array<CazooPreviewVehicle> = [];
  const seen = new Set<string>();
  for (let page = 1; page <= 5; page++) {
    const pageUrl = page === 1 ? dealerUrl : `${dealerUrl}?page=${page}`;
    const html = await fetchCazooHtml(pageUrl);
    const rows = parseDealerPage(html);
    let added = 0;
    for (const row of rows) {
      if (!seen.has(row.listingId)) {
        seen.add(row.listingId);
        all.push(row);
        added++;
      }
    }
    // Stop when a page adds nothing new (last page reached or no pagination),
    // or the page returned fewer cards than a full page would.
    if (added === 0 || rows.length < 20) break;
  }
  return all;
}
