import { describe, expect, it } from "vitest";
import {
  DEFAULT_STAFF_MODULES,
  INCLUDED_MODULES,
  MODULE_KEYS,
  PREMIUM_MODULES,
  cleanModuleList,
  isModuleKey,
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
  it("gives a dealer with no exceptions every included module and no premium ones", () => {
    const got = resolveModules({});
    expect(got).toEqual(INCLUDED_MODULES);
    for (const k of PREMIUM_MODULES) expect(got).not.toContain(k);
  });
  it("stores only exceptions, which reproduce the chosen list", () => {
    const chosen = MODULE_KEYS.filter((k) => k !== "reports");
    const o = overridesFromList(chosen);
    expect(o.off).toEqual(["reports"]);
    expect(resolveModules(o)).toEqual(cleanModuleList(chosen));
  });
  it("reads the earlier full-list format as exceptions", () => {
    expect(readModuleSetting({ enabled: MODULE_KEYS.filter((k) => k !== "leads") })).toEqual({ on: [], off: ["leads"] });
    expect(readModuleSetting({ on: ["nonsense"], off: ["reports"] })).toEqual({ on: [], off: ["reports"] });
    expect(readModuleSetting(null)).toEqual({ on: [], off: [] });
  });
  it("ignores an 'on' for an included module and an 'off' for a premium one", () => {
    expect(resolveModules({ on: ["reports"], off: [] })).toEqual(INCLUDED_MODULES);
  });
});
