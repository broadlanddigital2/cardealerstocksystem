/**
 * Tests for the Cazoo health check evaluator (the site-redesign canary).
 *
 * evaluateParsedStock inspects live-parsed dealer rows and flags a Cazoo
 * markup change: zero rows, or a majority of rows missing key fields
 * (title/price/mileage/photo prefix). Also asserts the saved real dealer
 * fixture evaluates as healthy, so the alert wording stays tied to reality.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateParsedStock,
  parseDealerPage,
  type CazooPreviewVehicle,
} from "../src/lib/cazoo.js";

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");

function row(overrides: Partial<CazooPreviewVehicle> = {}): CazooPreviewVehicle {
  return {
    listingId: "123456",
    url: "https://www.cazoo.co.uk/cars-for-sale/123456/",
    make: "Ford",
    model: "Fiesta",
    year: 2018,
    derivative: "1.0 EcoBoost Zetec",
    title: "2018 Ford Fiesta 1.0 EcoBoost Zetec",
    price: 8995,
    mileage: 42_000,
    fuel: "Petrol",
    gearbox: "Manual",
    colour: null,
    vrm: null,
    marketingDescription: null,
    photoPrefix: "https://cdn.images.autoexposure.co.uk/AETA1/AETV1",
    photoCount: 12,
    thumbnailUrl: "https://cdn.images.autoexposure.co.uk/AETA1/AETV1_1e.jpg",
    ...overrides,
  };
}

describe("evaluateParsedStock", () => {
  it("reports zero rows as a failure", () => {
    const problems = evaluateParsedStock([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/zero rows/);
  });

  it("passes a healthy stock list", () => {
    expect(evaluateParsedStock([row(), row({ listingId: "2" })])).toEqual([]);
  });

  it("tolerates a minority of rows missing a field", () => {
    // 1 of 3 missing mileage — below the majority threshold, no alarm.
    const rows = [row(), row({ listingId: "2" }), row({ listingId: "3", mileage: null })];
    expect(evaluateParsedStock(rows)).toEqual([]);
  });

  it("flags a majority of rows missing prices", () => {
    const rows = [
      row({ price: null }),
      row({ listingId: "2", price: null }),
      row({ listingId: "3" }),
    ];
    const problems = evaluateParsedStock(rows);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/2 of 3 vehicles are missing their price/);
  });

  it("flags several broken fields at once", () => {
    const broken = [
      row({ title: "", price: null, mileage: null, photoPrefix: null }),
      row({ listingId: "2", title: " ", price: null, mileage: null, photoPrefix: null }),
    ];
    const problems = evaluateParsedStock(broken);
    expect(problems).toHaveLength(4);
    expect(problems.join(" ")).toMatch(/title/);
    expect(problems.join(" ")).toMatch(/price/);
    expect(problems.join(" ")).toMatch(/mileage/);
    expect(problems.join(" ")).toMatch(/photos/);
  });

  it("evaluates the saved real dealer page as healthy", () => {
    const rows = parseDealerPage(fixture("cazoo-dealer-page.html"));
    expect(rows.length).toBeGreaterThan(0);
    expect(evaluateParsedStock(rows)).toEqual([]);
  });
});
