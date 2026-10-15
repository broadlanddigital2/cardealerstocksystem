import { describe, expect, it } from "vitest";
import {
  DEFAULT_STAFF_MODULES,
  MODULE_KEYS,
  cleanModuleList,
  isModuleKey,
  moduleTier,
  overridesFromList,
  readModuleSetting,
  resolveModules,
} from "../../src/lib/modules";

describe("module catalogue", () => {
  it("drops unknown keys, duplicates and non-strings, keeping catalogue order", () => {
    expect(cleanModuleList(["leads", "nonsense", "reports", "leads", 3, null])).toEqual(["reports", "leads"]);
  });
  it("treats a non-array as no modules", () => {
    expect(cleanModuleList("reports")).toEqual([]);
    expect(cleanModuleList(undefined)).toEqual([]);
  });
  it("keeps today's rule as the staff default: everything except reports", () => {
    expect(DEFAULT_STAFF_MODULES).not.toContain("reports");
    expect(DEFAULT_STAFF_MODULES.length).toBe(MODULE_KEYS.length - 1);
  });
  it("recognises module keys", () => {
    expect(isModuleKey("cash_sheet")).toBe(true);
    expect(isModuleKey("settings")).toBe(false);
  });
});

describe("module tiers and dealer exceptions", () => {
  const core = MODULE_KEYS.filter((k) => moduleTier(k) === "core");
  it("gives a dealer with no exceptions every core module and no premium ones", () => {
    expect(resolveModules({})).toEqual(core);
  });
  it("follows the console's tier and on/off-for-everyone settings", () => {
    const catalogue = { reports: { tier: "premium" as const }, leads: { enabled: false } };
    const got = resolveModules({ catalogue });
    expect(got).not.toContain("reports");
    expect(got).not.toContain("leads");
    expect(resolveModules({ on: ["reports"], catalogue })).toContain("reports");
    // switched off for everyone wins over a dealer's own setting
    expect(resolveModules({ on: ["leads"], catalogue })).not.toContain("leads");
  });
  it("stores only exceptions, which reproduce the chosen list", () => {
    const catalogue = { reports: { tier: "premium" as const } };
    for (const chosen of [MODULE_KEYS.filter((k) => k !== "leads"), ["reports", "cash_sheet"], []]) {
      const o = overridesFromList(chosen, catalogue);
      expect(resolveModules({ ...o, catalogue })).toEqual(cleanModuleList(chosen));
    }
    expect(overridesFromList(["reports"], catalogue).on).toEqual(["reports"]);
  });
  it("reads the earlier full-list format and drops bad catalogue values", () => {
    expect(readModuleSetting({ enabled: MODULE_KEYS.filter((k) => k !== "leads") })).toEqual({ on: [], off: ["leads"], catalogue: {} });
    expect(readModuleSetting({ on: ["nonsense"], off: ["reports"], catalogue: { reports: { tier: "gold" }, x: {} } })).toEqual({
      on: [],
      off: ["reports"],
      catalogue: { reports: {} },
    });
    expect(readModuleSetting(null)).toEqual({ on: [], off: [], catalogue: {} });
  });
});
