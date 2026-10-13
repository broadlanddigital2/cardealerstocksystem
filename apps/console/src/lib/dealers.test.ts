import { describe, expect, it } from "vitest";
import { SLUG_RE, dealerInput } from "./dealers";

const base = { name: "Manor Garage", slug: "manor-garage", firstAdminEmail: "Owner@Example.co.uk", modules: ["reports", "nope"] };

describe("dealer form", () => {
  it("accepts a valid dealer and tidies values", () => {
    const r = dealerInput.parse({ ...base, webDomain: "https://www.ManorGCS.co.uk/", contactEmail: "" });
    expect(r.firstAdminEmail).toBe("owner@example.co.uk");
    expect(r.webDomain).toBe("www.manorgcs.co.uk");
    expect(r.contactEmail).toBeNull();
    expect(r.modules).toEqual(["reports"]);
  });
  it("checks the short id", () => {
    expect(SLUG_RE.test("manor-garage")).toBe(true);
    expect(SLUG_RE.test("Manor")).toBe(false);
    expect(SLUG_RE.test("ab")).toBe(false);
    expect(SLUG_RE.test("-bad")).toBe(false);
    expect(SLUG_RE.test("bad-")).toBe(false);
  });
});
