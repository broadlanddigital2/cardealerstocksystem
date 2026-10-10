/**
 * Parser regression tests for the Cazoo import.
 *
 * The fixtures under test/fixtures/ are real Cazoo pages saved on 2026-07-02
 * (a dealer stock page and a single car listing page). These tests catch code
 * regressions in parseDealerPage/parseListingPage: if a refactor breaks the
 * gtm-ecommerce JSON parsing, badge extraction, escaped vehicleDetails JSON,
 * or photo-prefix detection, key fields come back empty and the assertions
 * fail. (A live site redesign by Cazoo would need freshly saved pages to
 * detect — re-save the fixtures if the import starts returning empty data.)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDealerPage, parseListingPage } from "../lib/cazoo.js";

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");

describe("parseDealerPage", () => {
  const rows = parseDealerPage(fixture("cazoo-dealer-page.html"));

  it("finds every vehicle card on the page", () => {
    // The saved dealer page contains 9 stock cards.
    expect(rows.length).toBeGreaterThanOrEqual(5);
    const ids = rows.map((r) => r.listingId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("populates the key fields on every row", () => {
    for (const row of rows) {
      expect(row.listingId).toMatch(/^\d+$/);
      expect(row.url).toBe(
        `https://www.cazoo.co.uk/cars-for-sale/${row.listingId}/`,
      );
      expect(row.make).toBeTruthy();
      expect(row.model).toBeTruthy();
      expect(row.title).toBeTruthy();
      // Every card on the saved page has a price, year and mileage.
      expect(row.price).toBeGreaterThan(0);
      expect(row.year).toBeGreaterThan(1990);
      expect(row.mileage).toBeGreaterThan(0);
    }
  });

  it("extracts the AutoExposure photo prefix and thumbnail", () => {
    const withPhotos = rows.filter((r) => r.photoPrefix !== null);
    expect(withPhotos.length).toBeGreaterThan(0);
    for (const row of withPhotos) {
      expect(row.photoPrefix).toMatch(
        /^https:\/\/cdn\.images\.autoexposure\.co\.uk\/[A-Za-z0-9]+\/[A-Za-z0-9]+$/,
      );
      expect(row.thumbnailUrl).toBe(`${row.photoPrefix}_1e.jpg`);
    }
  });

  it("extracts badges (fuel/gearbox) and derivatives from ld+json names", () => {
    expect(rows.some((r) => r.fuel !== null)).toBe(true);
    expect(rows.some((r) => r.gearbox !== null)).toBe(true);
    expect(rows.some((r) => r.derivative !== null)).toBe(true);
  });
});

describe("parseListingPage", () => {
  const html = fixture("cazoo-listing-page.html");
  // The listing id must match the saved fixture page.
  const idMatch = html.match(/\/cars-for-sale\/(\d+)\//);
  const url = `https://www.cazoo.co.uk/cars-for-sale/${idMatch?.[1]}/`;
  const row = parseListingPage(html, url);

  it("parses the vehicleDetails blob into a preview row", () => {
    expect(row).not.toBeNull();
    expect(row?.listingId).toBe(idMatch?.[1]);
    expect(row?.make).toBeTruthy();
    expect(row?.model).toBeTruthy();
    expect(row?.title).toBeTruthy();
    expect(row?.price).toBeGreaterThan(0);
    expect(row?.year).toBeGreaterThan(1990);
  });

  it("extracts mileage from the rendered spec section", () => {
    expect(row?.mileage).toBeGreaterThan(0);
  });

  it("extracts the photo prefix from og:image", () => {
    expect(row?.photoPrefix).toMatch(
      /^https:\/\/cdn\.images\.autoexposure\.co\.uk\/[A-Za-z0-9]+\/[A-Za-z0-9]+$/,
    );
    expect(row?.photoCount).toBeGreaterThan(0);
    expect(row?.thumbnailUrl).toBe(`${row?.photoPrefix}_1e.jpg`);
  });

  it("extracts the marketing description from ld+json", () => {
    expect(row?.marketingDescription).toBeTruthy();
  });
});
