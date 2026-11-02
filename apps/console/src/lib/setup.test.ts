import { afterEach, describe, expect, it } from "vitest";
import { siteHost } from "./setup";

describe("dealer site names", () => {
  const before = process.env.CONSOLE_TARGET;
  afterEach(() => {
    process.env.CONSOLE_TARGET = before;
  });
  it("prefixes dealers made in the dev console so they never clash with live ones", () => {
    process.env.CONSOLE_TARGET = "dev";
    expect(siteHost({ slug: "manor-garage", staffDomain: null })).toBe("dev-manor-garage-stockbook.racecargraphics.uk");
    process.env.CONSOLE_TARGET = "live";
    expect(siteHost({ slug: "manor-garage", staffDomain: null })).toBe("manor-garage-stockbook.racecargraphics.uk");
  });
  it("uses the dealer's own staff address when set", () => {
    expect(siteHost({ slug: "x-y", staffDomain: "stock.example.co.uk" })).toBe("stock.example.co.uk");
  });
});
