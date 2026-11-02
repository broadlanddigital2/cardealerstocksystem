import { describe, expect, it } from "vitest";
import { confirmed, exportFileName, exportKeyBelongs } from "./removal";

const dealer = { slug: "test-dealer", exportKeys: ["dev/7-test-dealer/1/test-dealer-data-2026-11-03.zip"] } as never;

describe("dealer removal safety", () => {
  it("needs the exact short id typed to confirm", () => {
    expect(confirmed(dealer, "test-dealer")).toBe(true);
    expect(confirmed(dealer, " Test-Dealer ")).toBe(true);
    expect(confirmed(dealer, "test")).toBe(false);
    expect(confirmed(dealer, "")).toBe(false);
  });
  it("only downloads this dealer's own export files", () => {
    expect(exportKeyBelongs(dealer, "dev/7-test-dealer/1/test-dealer-data-2026-11-03.zip")).toBe(true);
    expect(exportKeyBelongs(dealer, "dev/8-other/1/other-data.zip")).toBe(false);
    expect(exportKeyBelongs({ exportKeys: null } as never, "x")).toBe(false);
  });
  it("names the download after the file", () => {
    expect(exportFileName("dev/7-test-dealer/1/test-dealer-data-2026-11-03.zip")).toBe("test-dealer-data-2026-11-03.zip");
  });
});
