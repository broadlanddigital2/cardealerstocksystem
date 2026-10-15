import { describe, expect, it } from "vitest";
import { SLUG_RE, dealerChoices, dealerInput, dealerModules, defaultModules } from "./dealers";

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

describe("dealer modules", () => {
  it("reads records from before tiers from their module list", () => {
    const all = dealerModules({ modules: ["reports", "leads"], modulesOn: null, modulesOff: null });
    expect(all).toEqual(["reports", "leads"]);
  });
  it("uses the stored exceptions once set, so new included modules appear", () => {
    expect(dealerModules({ modules: [], modulesOn: [], modulesOff: ["reports"] })).not.toContain("reports");
    expect(dealerModules({ modules: [], modulesOn: [], modulesOff: [] })).toContain("reports");
  });
});

describe("modules switched off for everyone", () => {
  it("keeps the dealer's own choice for when the module comes back", () => {
    const dealer = { modules: [], modulesOn: [], modulesOff: [] };
    const catalogue = { leads: { enabled: false } };
    expect(dealerModules(dealer, catalogue)).not.toContain("leads");
    expect(dealerChoices(dealer, catalogue)).toContain("leads");
  });
  it("starts new dealers with core modules only", () => {
    expect(defaultModules({ reports: { tier: "premium" } })).not.toContain("reports");
    expect(defaultModules({})).toContain("reports");
  });
});
