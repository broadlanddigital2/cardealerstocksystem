import { describe, expect, it } from "vitest";
import { DEFAULT_STAFF_MODULES, MODULE_KEYS, cleanModuleList, isModuleKey } from "../../src/lib/modules";

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
