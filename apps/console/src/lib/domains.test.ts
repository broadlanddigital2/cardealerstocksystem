import { describe, expect, it } from "vitest";
import { normaliseHostname } from "./domains";

describe("normaliseHostname", () => {
  it("accepts a dealer's address and tidies it", () => {
    expect(normaliseHostname("  Stock.ManorGarage.co.uk ")).toBe("stock.manorgarage.co.uk");
    expect(normaliseHostname("https://www.example.com/cars?x=1")).toBe("www.example.com");
  });

  it("rejects anything that isn't a hostname", () => {
    expect(normaliseHostname("")).toBeNull();
    expect(normaliseHostname("not a domain")).toBeNull();
    expect(normaliseHostname("localhost")).toBeNull();
  });

  it("rejects addresses on the platform domain", () => {
    expect(normaliseHostname("racecargraphics.uk")).toBeNull();
    expect(normaliseHostname("other-stockbook.racecargraphics.uk")).toBeNull();
  });
});
